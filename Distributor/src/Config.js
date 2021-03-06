const os = require('os');

function argToType(arg, type) {
    return type === 'number' ? parseInt(arg) : arg;
}

function getArgument(name, type, dResult) {
    return process.env[name] ? argToType(process.env[name], type) : dResult;
}

function maxConcurrent() {
    const defaultCpuCores = os.cpus().length;
    const fromArgOrDefault = getArgument('EXPOSE_MAX_CONCURRENT', 'number', defaultCpuCores);

    console.log(`Number of CPU cores: ${defaultCpuCores}`);
    console.log(`Max concurrent: ${fromArgOrDefault} concurrent test cases`);

    return fromArgOrDefault;
}

function timeFrom(envArg, defaultVal) {
    const SECOND = 1000;
    const MINUTE = SECOND * 60;
    const HOUR = MINUTE * 60;

    function timeToMS(timeString) {
        const suffix = timeString[timeString.length - 1];

        if (suffix === 's') {
            return SECOND * Number.parseInt(timeString.slice(0, -1));
        } else if (suffix === 'm') {
            return MINUTE * Number.parseInt(timeString.slice(0, -1));
        } else if (suffix === 'h') {
            return HOUR * Number.parseInt(timeString.slice(0, -1));
        } else {
            return Number.parseInt(timeString);
        }
    }

    return timeToMS(getArgument(envArg, 'string', defaultVal));
}

export default {
    maxConcurrent: maxConcurrent(), //max number of tests to run concurrently
    maxTime: timeFrom('EXPOSE_MAX_TIME', '2h'),
    testMaxTime: timeFrom('EXPOSE_TEST_TIMEOUT', '20m'),
    jsonOut: getArgument('EXPOSE_JSON_PATH', 'string', undefined), //By default ExpoSE does not generate JSON out
    printPaths: getArgument('EXPOSE_PRINT_PATHS', 'number', false), //By default do not print paths to stdout
    printDeltaCoverage: getArgument('EXPOSE_PRINT_COVERAGE', 'number', false),
    analyseScript: getArgument('EXPOSE_PLAY_SCRIPT', 'string', './scripts/play')
};