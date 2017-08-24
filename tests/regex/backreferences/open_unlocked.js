//Test modeling of looped references to open capture groups with a forced varying capture

var x = symbolic X initial '';

if (/^((.)\2)+$/.test(x)) {

	//This will only be reachable of the model accurately represents varying local groups
	if (x.length == 4) {
		if (x.charAt(0) != x.charAt(2)) {
			throw 'Reachable';
		}
	}

	throw 'Reachable';
}