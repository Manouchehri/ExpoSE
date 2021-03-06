var x = symbolic X initial '';

assume x.length < 10;

if (/^z*$/.test(x)) {
	
	if (x == '') {
		throw 'Reachable';
	}

	for (var i = 0; i < x.length; i++) {
		if (x[i] != 'z') {
			throw 'Unreachable';
		}
	}

	throw 'Reachable';
}