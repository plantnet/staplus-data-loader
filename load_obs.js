'use strict';

const axios = require('axios');
const Database = require('arangojs').Database;
const AQL = require('arangojs').aql;

const env = require('./env.json');

/**
 * Lit n observations depuis la base de données Pl@ntNet et les charge dans FrostServer-STAPLUS via HTTP
 * (5è implémentation, 2022-03-29 − STAPLUS avec Long IDs)
 */

const frostRootURL = env.frostserver.rootURL;
const frostPublicURL = env.frostserver.publicURL;
const projectName = "Pl@ntNet DaaS STAPLUS";

const bsRootURL = env.bsURL;
const identifyUrl = 'https://identify.plantnet.org';

const usernamePasswordBuffer = Buffer.from(env.frostserver.username + ':' + env.frostserver.password);
const base64data = usernamePasswordBuffer.toString('base64');
const ax = axios.create({
    headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        'Authorization': `Basic ${base64data}`,
    }
});

let projectId;
let imagesObservedPropertyId;
let taxonsObservedPropertyId;
let organsObservedPropertyId;
let cameraSensorId;
let plantnetAppSensorId;
let previousObsAlreadyExisted = true;

async function main() {
    // connect to ArangoDB
    const adb = new Database({
        url: `http://${env.arangodb.host}:${env.arangodb.port}`,
        databaseName: env.arangodb.databaseName,
        auth: {
            username: env.arangodb.userName,
            password: env.arangodb.password
        }
    });
    console.log('ArangoDB: connected to [' + env.arangodb.databaseName + ']');

    // Project, licences…
    await initSTAPLUSCommonData();

    // --------- fetch obs from PN ---------------------------------------------

    // exemple d'obs PN assez complète : '1003000001'

    let startKey = "1000000000";
    const pageSize = 1000;
    // const pageSize = 1; // debug
    const limit = 15000000;
    // const limit = 1; // debug
    let nbObsTotal = 0;

    while (nbObsTotal < limit) {
        const query = AQL`
            FOR o IN ${adb.collection('observations')}
                FILTER o._key > ${startKey}
                SORT o._key
                LIMIT ${pageSize}
                LET species = (
                    FOR p IN ${adb.collection('projects')}
                        FILTER p._key == o.project_id
                        FOR t IN ${adb.collection('taxa')}
                            FILTER t.name == o.computed.current_name
                            FILTER t.species_list
                            FOR sp IN t.species_list
                                FILTER sp.nameAccordingTo == p._pn_key
                                RETURN MERGE(sp, {
                                    gbifId: t.gbif.id
                                })
                )[0]
                LET determinations_votes = (
                    FILTER o.computed.votes
                    FOR v IN o.computed.votes
                        RETURN {
                            name: v.name,
                            plus: v.plus,
                            score: v.score.total
                        }
                )
                LET images_votes = (
                    FILTER o.images
                    FOR i IN o.images 
                        LET images_organs = (
                            LET icov = (i.computed.organs_votes == NULL ? {} : i.computed.organs_votes)
                            FOR org IN ATTRIBUTES(icov)
                                RETURN {
                                    name: org,
                                    plus: i.computed.organs_votes[org].plus,
                                    score: i.computed.organs_votes[org].score.total
                                }
                        )
                        RETURN {
                            id: i.id,
                            quality: {
                                plus: i.computed.quality_votes.plus,
                                minus: i.computed.quality_votes.minus,
                                score: i.computed.quality_votes.score.total
                            },
                            organs: images_organs
                        }
                )
                RETURN MERGE(o, { species, determinations_votes, images_votes })
        `;
        // console.debug('QUERY', query);
        const cursor = await adb.query(query);
        const obs = await cursor.all();
        // console.debug('RESULT', obs[0]);

        // store into FrostServer
        const nbWritten = await writeToFrost(obs);

        startKey = obs[obs.length - 1]._key;
        console.debug('new startKey: ' + startKey + ' (' + typeof startKey + ')');
        nbObsTotal = nbObsTotal + nbWritten;
        console.debug("> total obs written: " + nbObsTotal);
    }
}

/**
 * Created global / generic entities for the whole dataset:
 *  - project
 *  - generic observed properties (images, taxons, organs)
 *  - generic sensors (generic camera, generic PN app)
 */
async function initSTAPLUSCommonData() {
    // project
    projectId = await exists("Projects", "name", projectName);
    if (! projectId) {
        console.debug('create project: ' + projectName);
        const resp = await ax.post(frostRootURL + '/Projects', {
            name: projectName,
            description: "Sharing Pl@ntNet botanical observations in STAPLUS format",
            url: 'https://identify.plantnet.org',
            termsOfUse: "This is a read-only copy of Pl@ntNet plant observations data, for internal usage by Cos4Cloud members only",
            privacyPolicy: "This project stores the user's globally unique identifier that cannot be used to retrieve personal information",
            creationTime: new Date().toISOString(),
            classification: "public"
        });
        projectId = getEntityId(resp);
    } else {
        console.debug('project already exists: ' + projectName + ' / ' + projectId);
    }

    // ObservedProperty (images)
    imagesObservedPropertyId = await exists("ObservedProperties", "name", "Picture");
    if (! imagesObservedPropertyId) {
        const resp = await ax.post(frostRootURL + '/ObservedProperties', {
            name: 'Picture',
            definition: 'https://www.merriam-webster.com/dictionary/picture',
            description: 'The plant image taken by the camera'
        });
        imagesObservedPropertyId = getEntityId(resp);
    }

    // ObservedProperty (taxons)
    taxonsObservedPropertyId = await exists("ObservedProperties", "name", "Taxon");
    if (! taxonsObservedPropertyId) {
        const resp = await ax.post(frostRootURL + '/ObservedProperties', {
            name: 'Taxon',
            definition: 'https://www.merriam-webster.com/dictionary/taxon',
            description: 'The species determination proposal given by the Pl@ntNet app/website for the observed plant'
        });
        taxonsObservedPropertyId = getEntityId(resp);
    }

    // ObservedProperty (organs)
    organsObservedPropertyId = await exists("ObservedProperties", "name", "Organ");
    if (! organsObservedPropertyId) {
        const resp = await ax.post(frostRootURL + '/ObservedProperties', {
            name: 'Organ',
            definition: 'https://www.merriam-webster.com/dictionary/organ',
            description: 'The organ submitted through the Pl@ntNet app/website for the observed plant'
        });
        organsObservedPropertyId = getEntityId(resp);
    }

    // Sensor (images) : appareil photo "générique" de n'importe quel appareil #triche
    cameraSensorId = await exists("Sensors", "name", "Generic camera");
    if (! cameraSensorId) {
        const resp = await ax.post(frostRootURL + '/Sensors', {
            name: 'Generic camera',
            description: 'Generic camera of any telephone/computer',
            encodingType: 'image/jpeg',
            metadata: ''
        });
        cameraSensorId = getEntityId(resp);
    }

    // Sensor (taxons/organs) : appli Pl@ntNet "générique" de n'importe quel appareil #triche
    plantnetAppSensorId = await exists("Sensors", "name", "Pl@ntNet AI");
    if (! plantnetAppSensorId) {
        const resp = await ax.post(frostRootURL + '/Sensors', {
            name: 'Pl@ntNet AI',
            description: 'Pl@ntNet AI called from generic app/website running on any telephone/computer',
            encodingType: 'application/json',
            metadata: ''
        });
        plantnetAppSensorId = getEntityId(resp);
    }
}

/**
 * Returns @iot.id if a STAPLUS $entity having $property = $value exists
 * @param {string} entity ex: "Projects"
 * @param {string} property ex: "name"
 * @param {any} value ex: "My tabarnak de project"
 */
async function exists(entity, property, value) {
    const url = frostRootURL + '/' + entity + '?$filter=' + property + " eq '" + encodeURIComponent(value) + "'";
    // console.log(url);
    const response = await ax.get(url);
    // console.debug(response.data);
    let iotId = null;
    for (const d of response.data.value) {
        if (d[property] == value) {
            iotId = d['@iot.id'];
            break;
        }
    }
    return iotId;
}

/**
 * Extracts iot ID from FrostServer response to POST entity creation
 * @param {object} resp 
 */
function getEntityId(resp) {
    // console.log(resp);
    // try long ID
    const longMatch = resp.headers.location.match(/[^(]+\(([0-9]+)\)$/);
    if (longMatch && Array.isArray(longMatch) && longMatch.length > 1) {
        return Number(longMatch[1]);
    }
    // try UUID
    const uuidMatch = resp.headers.location.match(/[^(]+\('([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'\)$/);
    if (uuidMatch && Array.isArray(uuidMatch) && uuidMatch.length > 1) {
        return uuidMatch[1];
    }
    // give up
    return null;
}

/**
 * Returns a license key of pre-loaded STAPLUS licenses,
 * from a license string present in Pl@ntNet observation
 * @param {string} pnLicense 
 * @returns {string} a license key from STAPLUS, or 'unknown'
 */
function detectLicense(pnLicense) {
    const mapping = {
        'cc-by': 'CC_BY',
        'cc-by-nc': 'CC_BY_NC',
        'cc-by-sa': 'CC_BY_SA',
        'cc-by-nc-sa': 'CC_BY_NC_SA',
        'cc-by-nd': 'CC_BY_ND', // there should be none in PN
        'cc-by-nc-nd': 'CC_BY_NC_ND', // there should be none in PN
        'gpl': 'CC_BY_SA', // @TODO or add license ? Only ~1000 obs
        'public': 'CC_PD'
    };
    if (Object.keys(mapping).includes(pnLicense)) {
        return mapping[pnLicense];
    } else {
        console.debug(" ! unknown license: " + pnLicense);
        return "unknown"; // @TODO © ?
    }
}

/**
 * Writes given PN obs to FrostServer-STAPLUS through HTTP API,
 * using secure-dimensions STAPLUS format
 * @param {Array} observations 
 * @param {boolean} noDuplicates if true, will check if an observation
 *   with the same PN ID exists, before adding it
 */
async function writeToFrost(observations, noDuplicates=true) {
    console.log("writing " + observations.length + " obs");
    let written = 0;
    for (const obs of observations) {
        // console.log(obs);
        // skip deleted, censored, malformed, copyrighted obs
        if (obs.deleted) {
            console.debug(" ! skip deleted obs: " + obs._key);
            continue;
        }
        if (obs.computed && obs.computed.censored) {
            console.debug(" ! skip censored obs: " + obs._key);
            continue;
        }
        if (obs.computed && obs.computed.malformed) {
            console.debug(" ! skip malformed obs: " + obs._key);
            continue;
        }
        if (obs.license === "©") {
            console.debug(" ! skip copyrighted obs: " + obs._key);
            continue;
        }
        if (obs.partner && obs.partner.id && obs.partner.id != "c4c") {
            console.debug(" ! skip partner obs (" + obs.partner.id + "): " + obs._key);
            continue;
        }

        // check if obs already exists in FROST
        // optimization: only if previous obs already existed (obs are processed
        // sequentially and can already exist only if 2 runs of this script overlap)
        if (noDuplicates && previousObsAlreadyExisted) {
            let obsFrostId = await exists("Groups", "name", obs._key);
            if (obsFrostId) {
                console.debug(" ! skip already existing obs: " + obs._key);
                continue;
            }
        }
        previousObsAlreadyExisted = false; // global

        let imagesDatastreamId;
        let taxonsDatastreamId;
        let organsDatastreamId;
        // Party : utilisateur
        if (! obs.author.id) {
            console.error(' ! PN obs ' + obs._key + ' has no author id');
            continue;
        }
        let partyId = await exists("Parties", "authId", obs.author.id);

        // new user
        if (! partyId) {
            let resp;
            resp = await ax.post(frostRootURL + '/Parties', {
                name: obs.author.name,
                description: 'Pl@ntNet user: ' + obs.author.name + ' (PN id: ' + obs.author.id + ')',
                role: 'individual',
                authId: '' + obs.author.id,
                displayName: obs.author.name
            });
            partyId = getEntityId(resp);

            // Thing : téléphone de l'utilisateur (ou ordinateur)
            resp = await ax.post(frostRootURL + '/Things', {
                name: 'Generic device of Party@iot.id:' + partyId,
                description: 'Telephone/computer of user: ' + obs.author.name + ' (PN id:' + obs.author.id + ')',
                properties: obs.client
            });
            const thingId = getEntityId(resp);

            // use generic sensors

            const datastreamsPromises = [];
            const licenseId = detectLicense(obs.license);
            // console.log(`partyId: ${partyId}, imagesObservedPropertyId: ${imagesObservedPropertyId}, licenseId: ${licenseId}, cameraSensorId: ${cameraSensorId}, thingId: ${thingId}, projectId: ${projectId}`);
            // Datastream (images)
            datastreamsPromises.push(ax.post(frostRootURL + '/Datastreams', {
                unitOfMeasurement: {
                    name: 'n/a',
                    symbol: '',
                    definition: 'https://www.merriam-webster.com/dictionary/picture'
                },
                name: 'Pictures datastream of Party@iot.id:' + partyId,
                description: 'Datastream of pictures produced by user: ' + obs.author.name + ' (PN id:' + obs.author.id + ')',
                observationType: 'Picture',
                ObservedProperty: { '@iot.id': imagesObservedPropertyId },
                License: { '@iot.id': licenseId },
                Sensor: { '@iot.id': cameraSensorId },
                Party: { '@iot.id': partyId },
                Thing: { '@iot.id': thingId },
                Project: { '@iot.id': projectId }
            }));
    
            // Datastream (taxons)
            datastreamsPromises.push(ax.post(frostRootURL + '/Datastreams', {
                unitOfMeasurement: {
                    name: 'Pl@ntNet species',
                    symbol: '',
                    definition: 'https://identify.plantnet.org/the-plant-list/species' // @TODO URL of generic explorator (without project)
                },
                name: 'Taxons datastream of Party@iot.id:' + partyId,
                description: 'Datastream of species determinations produced by user: ' + obs.author.name + ' (PN id:' + obs.author.id + ')',
                observationType: 'Plant species',
                ObservedProperty: { '@iot.id': taxonsObservedPropertyId },
                License: { '@iot.id': licenseId },
                Sensor: { '@iot.id': plantnetAppSensorId },
                Party: { '@iot.id': partyId },
                Thing: { '@iot.id': thingId },
                Project: { '@iot.id': projectId }
            }));
    
            // Datastream (organs)
            datastreamsPromises.push(ax.post(frostRootURL + '/Datastreams', {
                unitOfMeasurement: {
                    name: 'Pl@ntNet organ',
                    symbol: '',
                    definition: 'bark, flower, fruit, habit, leaf…'
                },
                name: 'Organs datastream of Party@iot.id:' + partyId,
                description: 'Datastream of organ tags produced by user: ' + obs.author.name + ' (PN id:' + obs.author.id + ')',
                observationType: 'Plant organ',
                ObservedProperty: { '@iot.id': organsObservedPropertyId },
                License: { '@iot.id': licenseId },
                Sensor: { '@iot.id': plantnetAppSensorId },
                Party: { '@iot.id': partyId },
                Thing: { '@iot.id': thingId },
                Project: { '@iot.id': projectId }
            }));
            const datastreamsResponses = await Promise.all(datastreamsPromises);
            imagesDatastreamId = getEntityId(datastreamsResponses[0]);
            taxonsDatastreamId = getEntityId(datastreamsResponses[1]);
            organsDatastreamId = getEntityId(datastreamsResponses[2]);

        } else {
            // fetch existing author Datastreams
            const resp = await ax.get(frostRootURL + "/Parties('" + partyId + "')?$expand=Datastreams");
            for (let i = 0; i < resp.data.Datastreams.length; i++) {
                const ds = resp.data.Datastreams[i];
                if (ds.name.substring(0, 8) === 'Pictures') {
                    imagesDatastreamId = ds['@iot.id'];
                } else if (ds.name.substring(0, 6) === 'Taxons') {
                    taxonsDatastreamId = ds['@iot.id'];
                } else if (ds.name.substring(0, 6) === 'Organs') {
                    organsDatastreamId = ds['@iot.id'];
                } else {
                    throw new Error('cannot parse datastream #' + i + ' for Party@iot.id:' + partyId);
                }
            }
        }
        // console.log(">> idid/tdid/odid", imagesDatastreamId, taxonsDatastreamId, organsDatastreamId);

        // FeatureOfInterest : la plante (l'individu physique) localisé
        const hasGeoloc = (obs.geoloc && obs.geoloc.lat && obs.geoloc.lon);
        let resp = await ax.post(frostRootURL + '/FeaturesOfInterest', {
            name: (obs.geoloc || {}).locality || '', // OGC says "put location name here (J. Speckamp)"
            description: 'Location of plant observed (PN observation id:' + obs._key + ')',
            encodingType: hasGeoloc ? 'application/geo+json' : 'application/json', // geojson forces non-empty coordinates
            feature: hasGeoloc ? {
                type: 'Point',
                coordinates: [ obs.geoloc.lon, obs.geoloc.lat ] // important ! lon-lat and not lat-lon
            } : { },
            properties: obs.geoloc || {} // keep everything (includes location name)
        });
        const featureOfInterestId = getEntityId(resp);

        // Groupe et multiples Observations : les données de l'obs PN (image(s) et détermination initiale)
        const dateObs = new Date(obs.date_obs).toISOString();
        // observations de type "image" et "organe"
        const observations = [];
        let nbNonDeletedImages = 0;
        for (const image of obs.images) {
            // skip deleted, noplant images
            if (image.deleted) {
                console.debug(" ! skip deleted image: " + obs._key + '/' + image.id);
                continue;
            }
            if (image.computed && image.computed.noplant) {
                console.debug(" ! skip noplant image: " + obs._key + '/' + image.id);
                continue;
            }
            nbNonDeletedImages++;
            // image
            observations.push({
                phenomenonTime: dateObs,
                resultTime: dateObs,
                result: bsRootURL + image.id,
                FeatureOfInterest: { '@iot.id': featureOfInterestId },
                Datastream: { '@iot.id': imagesDatastreamId }
            });
            // organ
            observations.push({
                phenomenonTime: dateObs,
                resultTime: dateObs,
                result: ((image.computed || {}).current_organ) || (image.submitted || {}).organ || '',
                FeatureOfInterest: { '@iot.id': featureOfInterestId },
                Datastream: { '@iot.id': organsDatastreamId }
            });
        }
        // détermination initiale
        observations.push({
            phenomenonTime: dateObs,
            resultTime: dateObs,
            result: ((obs.computed || {}).current_name) || (obs.submitted || {}).name || '',
            parameters:  obs.species ? { // taxonomic enrichment
                family: obs.species.family.scientificName,
                genus: obs.species.genus.scientificName,
                scientificNameWithoutAuthor: obs.species.scientificNameWithoutAuthor,
                scientificNameAuthorship: obs.species.scientificNameAuthorship,
                taxonomicStatus: obs.species.taxonomicStatus,
                synonyms: obs.species.synonyms,
                gbif: obs.species.gbifId ? { id: obs.species.gbifId } : null
            } : null,
            FeatureOfInterest: { '@iot.id': featureOfInterestId },
            Datastream: { '@iot.id': taxonsDatastreamId }
        });

        // Groupe (entité principale)
        resp = await ax.post(frostRootURL + '/Groups', {
            name: obs._key,
            description: 'Pl@ntNet Observation: picture(s), organ(s) and current determination (PN id:' + obs._key + ')',
            creationTime: dateObs,
            // runtime: null
            // purpose: ?
            Observations: observations,
            properties: {
                url: identifyUrl + '/' + obs.project_id + '/observations/' + obs._key,
                project_id: obs.project_id,
                date_updated: new Date(obs.date_updated).toISOString(),
                date_observed: new Date(obs.date_obs).toISOString(),
                date_created: new Date(obs.date_created).toISOString(),
                submitted: obs.submitted,
                valid: (obs.computed || {}).valid || false,
                // votes (agrégés seulement)
                votes: {
                    determinations: obs.determinations_votes,
                    images: obs.images_votes
                }
            }
        });
        const groupId = getEntityId(resp);
        // console.log(resp);

        // Relations
        // load newly created Group to find Observation ids

        const oGroup = await ax.get(frostRootURL + "/Groups(" + groupId + ")?$expand=Observations&$top=1000"); // increase $top (default 100) for obs with 50+ images
        const relations = [];
        let oGroupObsIndex = 0; // order is important
        // check presence of required number of Observations in oGroup
        const requiredLength = (2 * nbNonDeletedImages + 1); // organ + picture for each image, + determination
        if (oGroup.data.Observations.length < requiredLength) {
            console.error(' ! PN obs ' + obs._key + ' has length ' + oGroup.data.Observations.length + ' instead of ' + requiredLength + ' (' + nbNonDeletedImages + ' pictures, 1 determination)');
            continue;
        }
        // determination (last observation in array)
        const speciesObject = oGroup.data.Observations[(oGroup.data.Observations.length - 1)];
        for (let i = 0; i < nbNonDeletedImages; i++) {
            // image
            const pictureObject = oGroup.data.Observations[oGroupObsIndex];
            relations.push({
                role: 'dwc:Identification',
                Subject: { '@iot.id': speciesObject['@iot.id'] },
                Object: { '@iot.id': pictureObject['@iot.id'] }
            });
            oGroupObsIndex++;
            // organ
            const organObject = oGroup.data.Observations[oGroupObsIndex];
            relations.push({
                role: 'organOf', // no dwc term for that :/
                Subject: { '@iot.id': organObject['@iot.id'] },
                Object: { '@iot.id': pictureObject['@iot.id'] }
            });
            oGroupObsIndex++;
        }
        const rPromises = [];
        for (const relation of relations) {
            rPromises.push(ax.post(frostRootURL + '/Relations', relation));
        }
        const relationsResponses = await Promise.all(rPromises);
        const relationsReferences = relationsResponses.map((rr) => {
            return { '@iot.id': getEntityId(rr) };
        });

        // update group with newly created relations
        await ax.patch(frostRootURL + "/Groups(" + groupId + ")", { Relations: relationsReferences });

        // @TODO feedbacks ?

        // @TODO pour chaque détermination partenaire : (la grosse galère)

            // [!existe?] Party : utilisateur
            // [!existe?] Thing : téléphone de l'utilisateur (ou ordinateur)
            // [!existe?] Sensor (taxons) : appli Pl@ntNet
            // [!existe?] Datastream (taxons)
            // Observation : taxon
            // PATCH Group
            // Relation : "partner determination" ? "vote" ?

        written++;
    }
    return written;
}

main().then(() => {
    console.log("success");
}).catch(err => {
    console.error(err);
});
