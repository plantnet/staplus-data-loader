# Pl@ntNet to FrostServer-STAPLUS data loader

Loads Pl@ntNet observations into FrostServer-STAPLUS for "Pl@ntNet data as a service"

Requires a running ArangoDB server having Pl@ntNet `observations` collection

## install

see [install FrostServer-STAPLUS](./install_FrostServer_STAPLUS.md)

## usage

copy `env.example.json` to `env.json`, adjust conf

### load PN obs into FrostServer

adjust `startKey`, `pageSize`, `limit` in file `load_obs.js`

then
```sh
nodejs load_obs.js
```

### admin script

```sh
nodejs admin.js
```

## test

```sh
npm test
```

## stats

2022-03-18 :
 * `load_obs.js` : **125k obs/h** writing to HTTP API
 * **1 Go per 200k obs** in PostgreSQL
 * **14 tuples per obs** in PostgreSQL
