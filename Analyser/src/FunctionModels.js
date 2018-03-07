/* Copyright (c) Royal Holloway, University of London | Contact Blake Loring (blake@parsed.uk), Duncan Mitchell (Duncan.Mitchell.2015@rhul.ac.uk), or Johannes Kinder (johannes.kinder@rhul.ac.uk) for details or support | LICENSE.md for license details */
"use strict";

import ObjectHelper from './Utilities/ObjectHelper';
import Log from './Utilities/Log';
import Z3 from 'z3javascript';
import Config from './Config';
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

function CloneReplace(list, item, n) {
    let clone = list.slice(0);
    clone[clone.indexOf(item)] = n;
    return clone;
}

function CloneRemove(list, item) {
    let c = list.slice(0);
    c.splice(list.indexOf(item), 1);
    return c;
}

function BuildModels() {
    let models = {};

    for (let item in Object.getOwnPropertyNames(Object.prototype)) {
        if (!ObjectHelper.startsWith(item, '__')) {
            delete models[item];
        }
    }

    function EnableCaptures(regex, real, string_s) {
        
        if (!Config.capturesEnabled) {
            Log.log('Captures disabled - potential loss of precision');
        }

        Log.logMid('Captures Enabled - Adding Implications');

        let implies = this.state.ctx.mkImplies(this.state.ctx.mkSeqInRe(string_s, regex.ast), this.state.ctx.mkEq(string_s, regex.implier))

        //Mock the symbolic conditional if (regex.test(/.../) then regex.match => true)
        regex.assertions.forEach(binder => this.state.pushCondition(binder, true));
        this.state.pushCondition(implies, true);
    }

    function BuildRefinements(regex, real, string_s) {

        if (!(Config.capturesEnabled && Config.refinementsEnabled)) {
            Log.log('Refinements disabled - potential accuracy loss');
            return {
                trueCheck: [],
                falseCheck: []
            };
        }
        
        Log.log('Refinements Enabled - Adding checks');

        function CheckCorrect(model) {
            let real_match = real.exec(model.eval(string_s).asConstant(model));
            let sym_match = regex.captures.map(cap => model.eval(cap).asConstant(model));
            Log.logMid('Regex sanity check ' + JSON.stringify(real_match) + ' vs ' + JSON.stringify(sym_match));
            return real_match && !Exists(real_match, sym_match, DoesntMatch);
        }

        function CheckFailed(model) {
            return !real.test(model.eval(string_s).asConstant(model));
        }

        let NotMatch = Z3.Check(CheckCorrect, (query, model) => {
            let not = this.state.ctx.mkNot(this.state.ctx.mkEq(string_s, this.state.ctx.mkString(model.eval(string_s).asConstant(model))));
            return [new Z3.Query(query.exprs.slice(0).concat([not]), [CheckFixed, NotMatch])];
        });

        let CheckFixed = Z3.Check(CheckCorrect, (query, model) => {
            //CheckCorrect will check model has a proper match
            let real_match = real.exec(model.eval(string_s).asConstant(model));

            if (real_match) {
                real_match = real_match.map(match => match || '');
                let query_list = regex.captures.map((cap, idx) => this.state.ctx.mkEq(this.state.ctx.mkString(real_match[idx]), cap));
                
                /*Log.logMid("WARN: TODO: Removing CheckFixed and NotMatch from checks may break stuff");
                let next_list = CloneReplace(query.checks, CheckFixed, Z3.Check(CheckCorrect, () => []));
                next_list = CloneReplace(query.checks, NotMatch, Z3.Check(CheckCorrect, () => [])); */

                return [new Z3.Query(query.exprs.slice(0).concat(query_list), [])];
            } else {
                Log.log('WARN: Broken regex detected ' + regex.ast.toString() + ' vs ' + real);
                Log.log('WARN: No Highly Specific Refinements');
                return [];
            }
        });

        let CheckNotIn = Z3.Check(CheckFailed, (query, model) => {
            Log.log('BIG WARN: False check failed, possible divergence');
            return [];
        });

        return {
            trueCheck: [NotMatch, CheckFixed],
            falseCheck: [CheckNotIn]
        };
    }

    function RegexTest(regex, real, string, forceCaptures) {
        let in_s = this.state.ctx.mkSeqInRe(this.state.asSymbolic(string), regex.ast);
        let in_c = real.test(this.state.getConcrete(string));
        let result = new ConcolicValue(in_c, in_s);

        if (regex.backreferences || forceCaptures) {
            EnableCaptures.call(this, regex, real, this.state.asSymbolic(string));
            let checks = BuildRefinements.call(this, regex, real, this.state.asSymbolic(string));
            console.log('CReating Checks ' + checks.trueCheck.length);
            in_s.checks.trueCheck = checks.trueCheck;
            //in_s.checks.falseCheck = checks.false;
        }

        console.log(JSON.stringify(in_s));

        return result;
    }

    function RegexSearch(real, string, result) {
        let regex = Z3.Regex(this.state.ctx, real);

        //TODO: There is only the need to force back references if anchors are not set
        let in_regex = RegexTest.apply(this, [regex, real, string, true]);
        
        let search_in_re = this.state.ctx.mkIte(this.state.getSymbolic(in_regex), regex.startIndex, this.state.wrapConstant(-1));

        return new ConcolicValue(result, search_in_re);
    }

    function RegexMatch(real, string, result) {

        let regex = Z3.Regex(this.state.ctx, real);

        let in_regex = RegexTest.apply(this, [regex, real, string, true]);
        this.state.symbolicConditional(in_regex);

        let string_s = this.state.asSymbolic(string);

        if (this.state.getConcrete(in_regex)) {

            let rewrittenResult = [];

            if (Config.capturesEnabled) {
                rewrittenResult = result.map((current_c, idx) => {
                    //TODO: This is really nasty, current_c should be a
                    return new ConcolicValue(current_c === undefined ? '' : current_c, regex.captures[idx]);
                });
            }

            rewrittenResult.index = new ConcolicValue(result.index, regex.startIndex);
            rewrittenResult.input = string;

            result = rewrittenResult;
        }

        return result;
    }

    function substringHelper(c, _f, base, args, result) {
        Log.log('WARNING: Symbolic substring support new and buggy ' + JSON.stringify(args));

        let target = c.state.asSymbolic(base);
        let start_off = c.state.ctx.mkRealToInt(c.state.asSymbolic(args[0]));

        let len;

        if (args[1]) {
            len = c.state.asSymbolic(args[1]);
            len = c.state.ctx.mkRealToInt(len);
        } else {
            len = c.state.ctx.mkSub(c.state.ctx.mkSeqLength(target), start_off);
        }

        return new ConcolicValue(result, c.state.ctx.mkSeqSubstr(target, start_off, len));
    }

    //TODO - Ouch
    function rewriteTestSticky(real, target, result) {
        
        if (real.sticky || real.global) {

            let lastIndex = real.lastIndex;
            let lastIndex_s = this.state.asSymbolic(real.lastIndex);
            let lastIndex_c = this.state.getConcrete(real.lastIndex);
            real.lastIndex = lastIndex_c;

            let realResult = real.exec(this.state.getConcrete(target));

            if (lastIndex_c) {
                let part_c = this.state.getConcrete(target);
                let part_s = this.state.getSymbolic(target);

                let real_cut = part_c.substring(lastIndex_c, part_c.length);

                target = substringHelper.call(this,
                    this, null, target,
                    [lastIndex, new ConcolicValue(part_c.length, this.state.ctx.mkSeqLength(part_s))],
                    real_cut
                );
            }

            let matchResult = RegexMatch.call(this, real, target, realResult);

            if (matchResult) {
                let firstAdd = new ConcolicValue(lastIndex_c + this.state.getConcrete(matchResult.index), this.state.symbolicBinary('+', lastIndex_c, lastIndex_s, this.state.getConcrete(matchResult.index), this.state.asSymbolic(matchResult.index)));
                let secondAdd = new ConcolicValue(this.state.getConcrete(firstAdd), this.state.getConcrete(matchResult[0]).length, 
                    this.state.symbolicBinary('+', this.state.getConcrete(firstAdd), this.state.asSymbolic(firstAdd), this.state.getConcrete(matchResult[0].length), this.state.ctx.mkSeqLength(this.state.asSymbolic(matchResult[0]))));
                real.lastIndex = secondAdd;
                return true;
            } else {
                return false;
            }

        } else {
            return RegexTest.call(this, Z3.Regex(this.state.ctx, real), real, target, false);
        }
    }

    /**
     * Symbolic hook is a helper function which builds concrete results and then,
     * if condition() -> true executes a symbolic helper specified by hook
     * Both hook and condition are called with (context (SymbolicExecutor), f, base, args, result)
     *
     * A function which makes up the new function model is returned
     */
    function symbolicHook(condition, hook, featureDisabled) {
        return function(f, base, args, result) {

            result = undefined;
            let thrown = undefined;

            //Defer throw until after hook has run
            try {
                result = f.apply(this.state.getConcrete(base), map.call(args, arg => this.state.getConcrete(arg)));
            } catch (e) {
                thrown = e;
            }

            Log.logMid(`Symbolic Testing ${f.name} with base ${ObjectHelper.asString(base)} and ${ObjectHelper.asString(args)} and initial result ${ObjectHelper.asString(result)}`);

            if (!featureDisabled && condition(this, f, base, args, result)) {
                result = hook(this, f, base, args, result);
            }

            Log.logMid(`Result: ${'' + result} Thrown: ${'' + thrown}`);

            if (thrown) {
                throw thrown;
            }

            return result;
        };
    }

    //Hook for regex methods, will only hook if regex is enabled
    function symbolicHookRe(condition, hook) {
        return symbolicHook(condition, function(env) {
            //Intercept the hook to do regex stats
            env.state.stats.seen('regex');
            return hook.apply(this, arguments);
        }, !Config.regexEnabled);
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
        substringHelper
    );

    models[String.prototype.substring] = models[String.prototype.substr];

    models[String.prototype.charAt] = symbolicHook(
        (c, _f, base, args, _r) => c.state.isSymbolic(base) || c.state.isSymbolic(args[0]),
        (c, _f, base, args, result) => new ConcolicValue(result, c.state.ctx.mkSeqAt(c.state.asSymbolic(base), c.state.ctx.mkRealToInt(c.state.asSymbolic(args[0]))))
    );

    models[String.prototype.concat] = symbolicHook(
        (c, _f, base, args, _r) => c.state.isSymbolic(base) || find.call(args, arg => c.state.isSymbolic(arg)),
        (c, _f, base, args, result) => new ConcolicValue(result, c.state.ctx.mkSeqConcat([c.state.asSymbolic(base)].concat(args.map(arg => c.state.asSymbolic(arg)))))
    );

    models[String.prototype.indexOf] = symbolicHook(
        (c, _f, base, args, _r) => c.state.isSymbolic(base) || c.state.isSymbolic(args[0]) || c.state.isSymbolic(args[1]),
        (c, _f, base, args, result) => {
            let off = args[1] ? c.state.asSymbolic(args[1]) : c.state.asSymbolic(0);
            off = c.state.ctx.mkRealToInt(off);
            result = new ConcolicValue(result, c.state.ctx.mkSeqIndexOf(c.state.asSymbolic(base), c.state.asSymbolic(c._concretizeToString(args[0])), off));
            return result;
        }
    );

    models[String.prototype.search] = symbolicHookRe(
        (c, _f, base, args, _r) => c.state.isSymbolic(base) && args[0] instanceof RegExp,
        (c, _f, base, args, result) => RegexSearch.call(c, args[0], base, result)
    );

    models[String.prototype.match] = symbolicHookRe(
        (c, _f, base, args, _r) => c.state.isSymbolic(base) && args[0] instanceof RegExp,
        (c, _f, base, args, result) => RegexMatch.call(c, args[0], base, result)
    );

    models[RegExp.prototype.exec] = symbolicHookRe(
        (c, _f, base, args, _r) => base instanceof RegExp && c.state.isSymbolic(args[0]),
        (c, _f, base, args, result) => RegexMatch.call(c, base, args[0], result)
    );

    models[RegExp.prototype.test] = symbolicHookRe(
        (c, _f, _base, args, _r) => c.state.isSymbolic(args[0]),
        (c, _f, base, args, result) => rewriteTestSticky.call(c, base, c._concretizeToString(args[0]), result)
    );

    //Replace model for replace regex by string. Does not model replace with callback.
    models[String.prototype.replace] = symbolicHookRe(
        (c, _f, base, args, _r) => c.state.isSymbolic(base) && args[0] instanceof RegExp && typeof args[1] === 'string',
        (c, _f, base, args, result) => {
            return c.state.getConcrete(base).secret_replace.apply(base, args);
        }
    );

    models[String.prototype.split] = symbolicHookRe(
        (c, _f, base, args, _r) => c.state.isSymbolic(base) && args[0] instanceof RegExp,
        (c, _f, base, args, result) => {
            return c.state.getConcrete(base).secret_split.apply(base, args);
        }
    );

    models[String.prototype.trim] = symbolicHook(
        (c, _f, base, _a, _r) => c.state.isSymbolic(base),
        (c, _f, base, _a, result) => {
            Log.log('TODO: Trim model does not currently do anything');
            return new ConcolicValue(result, c.state.getSymbolic(base));
        }
    );

    models[String.prototype.toLowerCase] = function(f, base, args, result) {
        result = f.apply(this.state.getConcrete(base));

        if (this.state.isSymbolic(base)) {
            Log.log('TODO: Awful String.prototype.toLowerCase model will reduce search space');
            base = this._concretizeToString(base);
            let azRegex = Z3.Regex(this.state.ctx, /^[^A-Z]+$/);
            this.state.pushCondition(this.state.ctx.mkSeqInRe(this.state.getSymbolic(base), azRegex.ast), true);
            result = new ConcolicValue(result, this.state.getSymbolic(base));
        }

        return result;
    };

    models[Number.prototype.toFixed] = symbolicHook(
        (c, _f, base, args, _r) => c.state.isSymbolic(base) || c.state.isSymbolic(args[0]),
        (c, _f, base, args, result) => {
            const toFix = c.state.asSymbolic(base);
            const requiredDigits = c.state.asSymbolic(args[0]);
            const gte0 = c.state.ctx.mkGe(requiredDigits, c.state.ctx.mkIntVal(0));
            const lte20 = c.state.ctx.mkLe(requiredDigits, c.state.ctx.mkIntVal(20));
            const validRequiredDigitsSymbolic = c.state.ctx.mkAnd(lte20, gte0);
            const validRequiredDigits = c.state.getConcrete(args[0]) >= 0 && c.state.getConcrete(args[0]) <= 20;

            c.state.symbolicConditional(new ConcolicValue(!!validRequiredDigits, validRequiredDigitsSymbolic));

            if (validRequiredDigits) {
                //TODO: Need to coerce result to string

                // const pow = c.state.ctx.mkPower(c.state.asSymbolic(10), requiredDigits)
                // const symbolicValue = c.state.ctx.mkDiv(c.state.ctx.mkInt2Real(c.state.ctx.mkReal2Int(c.state.ctx.mkMul(pow, toFix))), c.state.asSymbolic(10.0))
                //return new ConcolicValue(result, symbolicValue);
                return result;
            }
            else {
                // f.Apply() will throw
            }
        }
    );

    let indexOfCounter = 0;

    models[Array.prototype.indexOf] = symbolicHook(
        (c, _f, base, args, _r) => c.state.isSymbolic(base) || c.state.isSymbolic(args[0]) || c.state.isSymbolic(args[1]),
        (c, _f, base, args, result) => {
            const ctx = c.state.ctx;

            // TODO AF Alter this SMT to use the second optional arg
            // const startIndex = args[1] ? c.state.asSymbolic(args[1]) : c.state.asSymbolic(0);
            const startIndex = c.state.asSymbolic(0);
            const searchTarget = c.state.asSymbolic(args[0]);
            const foundIndex = ctx.mkRealVar('__INDEX_OF_' + indexOfCounter);

            // result_s is either a resulting index where the value is found or -1
            const matchInArray = ctx.mkEq(ctx.mkSelect(c.state.asSymbolic(base), foundIndex), searchTarget);
            const result_s = ctx.mkIte(matchInArray, foundIndex, c.state.asSymbolic(-1));
            
            // check that if the resulting index is the lowest index using a quantifier
            const intSort = ctx.mkIntSort();
            const i = ctx.mkBound(0, intSort);
            const body = ctx.mkEq(ctx.mkSelect(c.state.asSymbolic(base), i), ctx.mkSelect(c.state.asSymbolic(base), foundIndex));
            // constraints on i
            const pattern = ctx.mkPattern([ctx.mkAnd(ctx.mkGt(i, ctx.mkIntVal(0)), ctx.mkLt(i, foundIndex))]);
            const func_decl_name = ctx.mkStringSymbol('i__INDEX_OF_' + indexOfCounter);
            const exists = ctx.mkExists([func_decl_name], intSort, body, []);

            // console.log(exists.toString());

            c.state.pushCondition(ctx.mkImplies(matchInArray, ctx.mkNot(exists)), true);
            
            return new ConcolicValue(result, result_s);
        }
    );


    let includesCounter = 0;
    models[Array.prototype.includes] = symbolicHook(
        (c, _f, base, args, _r) => c.state.isSymbolic(base) || c.state.isSymbolic(args[0]) || c.state.isSymbolic(args[1]),
        (c, _f, base, args, result) => {
            const ctx = c.state.ctx;

            const startIndex = c.state.asSymbolic(0);
            const searchTarget = c.state.asSymbolic(args[0]);
            const foundIndex = ctx.mkRealVar('__INCLUDES_' + includesCounter);

            const result_s = ctx.mkEq(ctx.mkSelect(c.state.asSymbolic(base), foundIndex), searchTarget);
            return new ConcolicValue(result, result_s);
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

    return models;
}

export default BuildModels();
