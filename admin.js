'use strict';

const axios = require('axios');

const AdminScript = require('./lib/AdminScript.js');
const libPg = require('./lib/LibPg.js');

const env = require('./env.json');

/**
 * Empties FrostServer-STAPLUS PostreSQL database
 */
class adminCLI extends AdminScript {

	constructor () {
		super();
		this.availableCommands = {
			'clean': 'WARNING! remove all data from table {tableId} in PostgreSQL',
			'cleanAll': 'WARNING! remove all data from PostgreSQL',
			'stats': 'get statistics about number of PN observation VS number of tuples in PostgreSQL',
			'getObsGroupById': 'get obs data for Group {id} using HTTP STAPLUS API',
			'getObsGroupsByUserId': 'get relevant data for Pl@ntNet {userId} using HTTP STAPLUS API'
		};
		this.lib = new libPg();
		this.rootURL = env.frostserver.rootURL;
	}

	async clean () {
		const tableId = process.argv[3];
		if (!tableId) {
			throw new Error('Missing table ID');
		}
		await this.lib.connect();
		const removed = await this.lib.delete(tableId.toUpperCase());
		console.log(removed + ' tuples removed');
		await this.lib.end();
	}

	async cleanAll () {
		await this.lib.connect();
		const removed = await this.lib.deleteAll();
		console.log('database cleaned (' + removed + ' tuples removed)');
		await this.lib.end();
	}

	async stats () {
		await this.lib.connect();
		const s = await this.lib.stats();
		console.log(s);
		await this.lib.end();
	}

	async getObsGroupById () {
		const observationGroupId = process.argv[3];
		if (!observationGroupId) {
			throw new Error('Missing ObservationGroup ID');
		}
		const url = this.rootURL + '/Groups(' + observationGroupId + ')?$expand=Observations,Relations,Observations/FeatureOfInterest,Observations/Datastream,Observations/Datastream/Party,Observations/Datastream/License,Observations/Datastream/Project';
		const response = await axios.get(url);
		console.log(response.data);
	}

	async getObsGroupsByUserId () {
		const pnUserId = process.argv[3];
		if (!pnUserId) {
			throw new Error('Missing Pl@ntNet user ID');
		}
		const url = this.rootURL + '/Groups?$expand=Observations,Relations,Observations/FeatureOfInterest,Observations/Datastream,Observations/Datastream/Party,Observations/Datastream/License,Observations/Datastream/Project&$filter=Observations/Datastream/Party/authId eq ' + pnUserId;
		const response = await axios.get(url);
		console.log(response.data);
	}
}

const script = new adminCLI();
script.run()
	.then(() => {
		console.log('adminCLI: finished');
	})
	.catch((e) => {
		console.error(e);
	});
