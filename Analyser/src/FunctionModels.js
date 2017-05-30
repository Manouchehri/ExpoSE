/* Copyright (c) Royal Holloway, University of London | Contact Blake Loring (blake_l@parsed.uk), Duncan Mitchell (Duncan.Mitchell.2015@rhul.ac.uk), or Johannes Kinder (johannes.kinder@rhul.ac.uk) for details or support | LICENSE.md for license details */
"use strict";

import ObjectHelper from './Utilities/ObjectHelper';
import Log from './Utilities/Log';
import Z3 from 'z3javascript';
import {
    WrappedValue,
    ConcolicValue
} from './Values/WrappedValue';

const find = Array.prototype.find;
const map = Array.prototype.map;


function Exists(array1, array2, pred) {

    for (let i = 0; i < array1.length; i++) {
        if (pred(array1[i], array2[i])) {
            return true;
        }
    }

    return false;
}

function DoesntMatch(l, r) {
    if (l === undefined) {
        return r !== '';
    } else {
        return l !== r;
    }
}

function CheckCorrect(model) {
    let real_match = Origin.exec(model.eval(symbolic).asConstant());
    let sym_match = TestRegex.captures.map(cap => model.eval(cap).asConstant());
    return real_match && !Exists(real_match, sym_match, DoesntMatch);
}


function BuildModels() {
    let models = {};

    for (let item in Object.getOwnPropertyNames(Object.prototype)) {
        if (!ObjectHelper.startsWith(item, '__')) {
            delete models[item];
        }
    }

    function RegexTest(regex, real, string) {
        let in_s = this.ctx.mkSeqInRe(this.state.asSymbolic(string), regex.ast);
        let in_c = real.test(this.state.getConcrete(string));
        return new ConcolicValue(in_c, in_s);
    }

    const CAPTURES_ENABLED = true;
    const REFINEMENTS_ENABLED = true;

    function RegexMatch(real, string, result) {

        let regex = Z3.Regex(this.ctx, real);

        console.log(`RegexMatch ${JSON.stringify(regex)} ${regex.ast} ${string} ${real}`);

        let in_regex = RegexTest.apply(this, [regex, real, string, result]);

        this.state.symbolicConditional(in_regex);

        if (result) {

            if (CAPTURES_ENABLED) {
                Log.logMid('Captures Enabled - Adding Implications');
                //Mock the symbolic conditional if (regex.test(/.../) then regex.match => true)
                regex.assertions.forEach(binder => this.state.pushCondition(binder, true));
                this.state.pushCondition(this.ctx.mkImplies(this.ctx.mkSeqInRe(this.state.getSymbolic(string), regex.ast), this.ctx.mkEq(this.state.getSymbolic(string), regex.implier)), true);
            } else {
                Log.log('Captures Disable - Potential loss of precision');
            }

            if (CAPTURES_ENABLED && REFINEMENTS_ENABLED) {
                Log.logMid('Refinements Enabled - Adding checks');

                let NotMatch = Z3.Check(CheckCorrect, (query, model) => {
                    console.log(model.eval(symbolic).asConstant());
                    let query_list = query.exprs.concat([ctx.mkNot(ctx.mkEq(symbolic, ctx.mkString(model.eval(symbolic).asConstant())))]);
                    return new Z3.Query(query_list, query.checks);
                });

                let CheckFixed = Z3.Check(CheckCorrect, (query, model) => {
                    let real_match = Origin.exec(model.eval(symbolic).asConstant());

                    if (!real_match) {
                        return [];
                    } else {
                        real_match = Origin.exec(model.eval(symbolic).asConstant()).map(match => match || '');
                        console.log(`Here ${real_match.length} in ${TestRegex.captures.length}`);
                        TestRegex.captures.forEach((x, idx) => {
                            console.log(`${x} => ${real_match[idx]}`);
                        });
                        let query_list = TestRegex.captures.map((cap, idx) => ctx.mkEq(ctx.mkString(real_match[idx]), cap));
                        return [new Z3.Query(query.exprs.concat(query_list), [Z3.Check(CheckCorrect, (query, model) => [])])];
                    }
                });

                this.state.pushCheck(NotMatch);
                this.state.pushCheck(CheckFixed);
            } else {
                Log.log('Refinements disabled - Potential loss of precision');
            }

            result = result.map((current_c, idx) => {
                if (typeof current_c == 'string') {
                    return CAPTURES_ENABLED ? new ConcolicValue(current_c, regex.captures[idx]) : current_c;
                } else {
                    return undefined;
                }
            });
        }

        return result;
    }

    /**
     * Symbolic hook is a helper function which builds concrete results and then,
     * if condition() -> true executes a symbolic helper specified by hook
     * Both hook and condition are called with (context (SymbolicExecutor), f, base, args, result)
     *
     * A function which makes up the new function model is returned
     */
    function symbolicHook(condition, hook) {
        return function(f, base, args, result) {

            result = f.apply(this.state.getConcrete(base), map.call(args, arg => this.state.getConcrete(arg)));

            Log.logMid(`Symbolic Testing ${f.name} with base ${ObjectHelper.asString(base)} and ${ObjectHelper.asString(args)} and initial result ${ObjectHelper.asString(result)}`);

            if (condition(this, f, base, args, result)) {
                result = hook(this, f, base, args, result);
            }

            Log.logMid(`Result: ${'' + result}`);

            return result;
        };
    }

    function NoOp() {
        return function(f, base, args, result) {
            Log.logMid(`NoOp ${f.name} with base ${ObjectHelper.asString(base)} and ${ObjectHelper.asString(args)}`);
            return f.apply(base, args);
        };
    }

    /**
     * Model for String(xxx) in code to coerce something to a string
     */
    models[String] = symbolicHook(
        (c, _f, _base, args, _result) => c.state.isSymbolic(args[0]),
        (c, _f, _base, args, result) => new ConcolicValue(result, c.state.asSymbolic(c._concretizeToString(args[0])))
    );

    models[String.prototype.substr] = symbolicHook(
        (c, _f, base, args, _) => c.state.isSymbolic(base) || c.state.isSymbolic(args[0]) || c.state.isSymbolic(args[1]),
        (c, _f, base, args, result) => {
            Log.log('WARNING: Symbolic substring support new and buggy');

            let target = c.state.asSymbolic(base);
            let start_off = c.ctx.mkRealToInt(c.state.asSymbolic(args[0]));

            let len;

            if (args[1]) {
                len = c.state.asSymbolic(args[1]);
                len = c.ctx.mkRealToInt(len);
            } else {
                len = c.ctx.mkSub(c.ctx.mkSeqLength(target), start_off);
            }

            return new ConcolicValue(result, c.ctx.mkSeqSubstr(target, start_off, len));
        }
    );

    models[String.prototype.substring] = models[String.prototype.substr];

    models[String.prototype.charAt] = symbolicHook(
        (c, _f, base, args, _r) => c.state.isSymbolic(base) || c.state.isSymbolic(args[0]),
        (c, _f, base, args, result) => new ConcolicValue(result, c.ctx.mkSeqAt(c.state.asSymbolic(base), c.ctx.mkRealToInt(c.state.asSymbolic(args[0]))))
    );

    models[String.prototype.concat] = symbolicHook(
        (c, _f, base, args, _r) => c.state.isSymbolic(base) || find.call(args, arg => c.state.isSymbolic(arg)),
        (c, _f, base, args, result) => new ConcolicValue(result, c.ctx.mkSeqConcat([c.state.asSymbolic(base)].concat(args.map(arg => c.state.asSymbolic(arg)))))
    );

    models[String.prototype.indexOf] = symbolicHook(
        (c, _f, base, args, _r) => c.state.isSymbolic(base) || c.state.isSymbolic(args[0]) || c.state.isSymbolic(args[1]),
        (c, _f, base, args, result) => {
            let off = args[1] ? c.state.asSymbolic(args[1]) : c.state.asSymbolic(0);
            off = c.ctx.mkRealToInt(off);

            //TODO: Rewrite this better
            result = new ConcolicValue(result, c.ctx.mkSeqIndexOf(c.state.asSymbolic(base), c.state.asSymbolic(c._concretizeToString(args[0])), off));
            c.state.getSymbolic(result).FORCE_EQ_TO_INT = true;
            return result;
        }
    );

    models[String.prototype.match] = symbolicHook(
        (c, _f, base, args, _r) => c.state.isSymbolic(base) && args[0] instanceof RegExp,
        (c, _f, base, args, result) => RegexMatch.call(c, args[0], base, result)
    );

    models[RegExp.prototype.exec] = symbolicHook(
        (c, _f, base, args, _r) => base instanceof RegExp && c.state.isSymbolic(args[0]),
        (c, _f, base, args, result) => RegexMatch.call(c, base, args[0], result)
    );

    models[RegExp.prototype.test] = symbolicHook(
        (c, _f, _base, args, _r) => c.state.isSymbolic(args[0]),
        (c, _f, base, args, result) => RegexTest.call(c, Z3.Regex(c.ctx, base), base, c._concretizeToString(args[0]), result)
    );

    //Replace model for replace regex by string. Does not model replace with callback.
    models[String.prototype.replace] = symbolicHook(
        (c, _f, base, args, _r) => c.state.isSymbolic(base) && args[0] instanceof RegExp && typeof args[1] === 'string',
        (c, _f, base, args, result) => {
            Log.log('TODO: Awful String.prototype.replace model will reduce search space');

            let test = c.state.getConcrete(base) === result;

            Log.logMid(`Replace test = ${test}`);

            let regex = Z3.Regex(c.ctx, args[0]);

            let baseInRe = c.ctx.mkSeqInRe(c.state.getSymbolic(base), regex.ast);
            test ? c.state.pushNot(baseInRe) : c.state.pushCondition(baseInRe);
            return new ConcolicValue(result, c.state.getSymbolic(base));
        }
    );

    models[String.prototype.trim] = symbolicHook(
        (c, _f, base, _a, _r) => c.state.isSymbolic(base),
        (c, _f, base, _a, result) => {
            Log.log('TODO: Trim model does not currently do anything');
            return new ConcolicValue(result, c.state.getSymbolic(base));
        }
    );

    models[Array.prototype.push] = NoOp();
    models[Array.prototype.keys] = NoOp();
    models[Array.prototype.concat] = NoOp();
    models[Array.prototype.forEach] = NoOp();
    models[Array.prototype.slice] = NoOp();
    models[Array.prototype.filter] = NoOp();
    models[Array.prototype.map] = NoOp();
    models[Array.prototype.shift] = NoOp();
    models[Array.prototype.unshift] = NoOp();
    models[Array.prototype.fill] = NoOp();

    //TODO: I need a model for indexOf

    models[String.prototype.toLowerCase] = function(f, base, args, result) {
        result = f.apply(this.state.getConcrete(base));

        if (this.state.isSymbolic(base)) {
            Log.log('TODO: Awful String.prototype.toLowerCase model will reduce search space');
            base = this._concretizeToString(base);
            let azRegex = Z3.Regex(this.ctx, /^[^A-Z]+$/);
            this.state.pushCondition(this.ctx.mkSeqInRe(this.state.getSymbolic(base), azRegex.ast), true);
            result = new ConcolicValue(result, this.state.getSymbolic(base));
        }

        return result;
    };

    return models;
}

export default BuildModels();