/* Copyright (c) Royal Holloway, University of London | Contact Blake Loring (blake@parsed.uk), Duncan Mitchell (Duncan.Mitchell.2015@rhul.ac.uk), or Johannes Kinder (johannes.kinder@rhul.ac.uk) for details or support | LICENSE.md for license details */

function buildTestList() {
    var testList = [];

    function buildTest(file, expectPaths, expectErrors) {
        testList.push({
            path: file,
            expectPaths: expectPaths,
            expectErrors: expectErrors
        });
    }

    //Core Javascript, no symbex / annotations
    buildTest('arrays/array_concrete_behaviour.js', 0, 0);
    buildTest('arrays/array_explore_bounds.js', 2, 0);
    buildTest('arrays/array_includes_push_combination.js', 2, 0);
    buildTest('arrays/array_includes.js', 2, 0);
    buildTest('arrays/array_index_get_or.js', 2, 0);
    buildTest('arrays/array_index_getter_is_symbolic.js', 2, 0);
    buildTest('arrays/array_index_matches_non_symbolic_value.js', 2, 0);
    buildTest('arrays/array_index_matches_symbolic_value.js', 4, 2);
    buildTest('arrays/array_index_of.js', 2, 0);
    buildTest('arrays/array_index_of_fails.js', 3, 0);
    buildTest('arrays/array_index_of_length.js', 1, 0);
    buildTest('arrays/array_index_of_lowest.js', 1, 0);
    buildTest('arrays/array_index_of_negative.js', 1, 0);
    buildTest('arrays/array_index_of.js', 2, 0);
    buildTest('arrays/array_indexof_includes_combination.js', 4, 0);
    buildTest('arrays/array_last_index_of.js', 2, 0);
    buildTest('arrays/array_length_numbers.js', 2, 0);
    buildTest('arrays/arra_push_index_of_combination.js', 2, 0);
    buildTest('arrays/array_push_length_increases.js', 2, 0);
    buildTest('arrays/array_push_value_matches.js', 3, 0);
    return testList;
}

exports["default"] = buildTestList();
module.exports = exports["default"];
