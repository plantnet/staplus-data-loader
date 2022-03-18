'use strict';

const path = require('path');
const confirm = require('async-prompt').confirm;

/**
 * A convenience class for writing administration scripts
 */
class AdminScript {

	constructor() {
		this.availableCommands = {
			'exampleCommand': 'will run function named exampleCommand() in the current object'
		};
	}

	usage() {
		console.log('Usage: ' + path.basename(process.argv[1]) + ' command');
		console.log('  command: one of');
		for (let c in this.availableCommands) {
			console.log('    "' + c + '"' + (this.availableCommands[c] ? (': ' + this.availableCommands[c]) : ''));
		}
	}

	async run() {
		// input filtering
		if (process.argv.length < 3) {
			this.usage();
			process.exit(1);
		}
		const command = process.argv[2];
		if (Object.keys(this.availableCommands).indexOf(command) === -1) {
			this.usage();
			process.exit(2);
		}
		// display command and optional args
		let args = [];
		for (let i=3; i < process.argv.length; i++) {
			args.push(process.argv[i]);
		}
		let commandDesc = '> running command "' + command + '"';
		if (args.length) {
			commandDesc += ' (' + args.join(',') + ')';
		}
		console.log(commandDesc);
		// run
		try {
			const before = new Date().getTime();
			await this[command]();
			const after = new Date().getTime();
			const took = Math.floor((after - before) / 1000);
			console.log('took: ' + took + 's');
		} catch (e) {
			console.error('command failed: ' + command);
			console.error(e);
		}
	}

	async confirm(question) {
		return await confirm(question + ' (y/N)');
	}

	exampleCommand() {
		console.log('Hi. This is the example function in AdminScript.');
	}
}

module.exports = AdminScript;
