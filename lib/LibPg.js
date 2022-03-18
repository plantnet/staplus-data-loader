'use strict';

const { Client } = require('pg');

const env = require('../env.json');

class STAPLUSPg {

	constructor() {
		this.client = new Client(env.postgresql);
		this.tables = [
			'DATASTREAMS',
			'FEATURES',
			'GROUPS',
			'GROUPS_OBSERVATIONS',
			'GROUPS_RELATIONS',
			'LICENSES',
			'OBSERVATIONS',
			'OBS_PROPERTIES',
			'PARTIES',
			'PROJECTS',
			'RELATIONS',
			'SENSORS',
			'THINGS'
		];
	}

	async connect() {
		await this.client.connect()
	}

	async end() {
		await this.client.end()
	}

	async delete(table) {
		if (! this.tables.includes(table)) {
			throw new Error('unknown table: ' + table);
		}
		const query = 'DELETE FROM "' + table + '"';
		// console.log("> run query", query);
		const res = await this.client.query(query)
		// console.log(res);
		return res.rowCount;
	}

	async deleteAll() {
		const tasks = [];
		for (const table of this.tables) {
			tasks.push(this.delete(table));
		}
		const allRes = await Promise.all(tasks);
		return allRes.reduce((a, b) => a + b, 0); // sum @WARNING cascade makes the number of deleted tuples wrong (too low)
	}

	async count(table) {
		return Number((await this.client.query('SELECT count(*) FROM "' + table + '"')).rows[0].count);
	}

	async countAll() {
		const tasks = [];
		const counts = {};
		for (const table of this.tables) {
			tasks.push(this.count(table));
		}
		const allRes = await Promise.all(tasks);
		for (let i = 0; i < allRes.length; i++) {
			counts[this.tables[i]] = allRes[i];
		}
		return counts;
	}

	async stats() {
		const nbObsPN = await this.count("GROUPS");
		const nbTuplesPerTable = await this.countAll();
		let nbTuples = 0;
		for (const k of Object.keys(nbTuplesPerTable)) {
			nbTuples += nbTuplesPerTable[k];
		}
		const avgNbTuplesPerObsPN = nbTuples > 0 ? (nbTuples / nbObsPN).toFixed(3) : 0;
		const dbSize = (await this.client.query("SELECT pg_size_pretty( pg_database_size('" + env.postgresql.database + "')) as size;")).rows[0].size;
		return { nbObsPN, nbTuples, avgNbTuplesPerObsPN, nbTuplesPerTable, dbSize };
	}
}

module.exports = STAPLUSPg;
