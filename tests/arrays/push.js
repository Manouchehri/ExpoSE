var x = symbolic X initial ['hi'];

if (x.length == 1) {

    console.log('X is ' + x);

    x.pop();

    console.log('X is ' + x + ' with length ' + x.length);

    if (x.length != 0) {
        throw 'Unreachable 1';
    }

    throw 'Reachable';
}
