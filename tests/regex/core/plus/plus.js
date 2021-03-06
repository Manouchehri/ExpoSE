//Test the + operator

var x = symbolic X initial '';

if (/^(hello)+(world)+$/.test(x)) {

	if (x.length == 0) {
		throw 'Unreachable';
	}

	if (x == '') {
		throw 'Unreachable';
	}

	if (x == 'hellohelloworld') {
		throw 'Reachable';
	}

	throw 'Reachable';
}

if (/^he+l+l+o_wor+l+d+$/.test(x)) {
	
	if (x == 'helllllo_world') {
		throw 'Reachable';
	}

	if (x == 'hello_world') {
		throw 'Reachable';
	}

	if (x == 'hellooooo_world') {
		throw 'Unreachable';
	}

	if (x.length == 0) {
		throw 'Unreachable';
	}

	throw 'Reachable';
}

if (/^h+$/.test(x)) {

	if (/^[^h]+$/.test(x)) {
		throw 'Unreachable';
	}

	throw 'Reachable';
}

if (/^z+$/.test(x)) {
	assume x.length < 5;
	
	for (var i = 0; i < x.length; i++) {
		if (x[i] != 'z') {
			throw 'Unreachable';
		}
	}

	throw 'Reachable';
}

throw 'Reachable';