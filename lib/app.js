/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 */

/*
 * Cloud API Application file. All the modules with routes definitions are
 * required from this file. Clients to all the SDC 7 backend APIs are created
 * from this file. Plugins are loaded from this file. All the application
 * server handlers are included, and some of them dfined, into this file.
 *
 */

var assert = require('assert-plus');
var fs = require('fs');
var http = require('http');
var https = require('https');
var path = require('path');

var createMetricsManager = require('triton-metrics').createMetricsManager;
var cueball = require('cueball');
var jsprim = require('jsprim');
var kang = require('kang');
var keyapi = require('keyapi');
var mahi = require('mahi');
var restify = require('restify');
var SDC = require('sdc-clients');
var semver = require('semver');
var UFDS = require('ufds');

var account = require('./account');
var auth = require('./auth');
var changefeed = require('./changefeed.js');
var configEndpoints = require('./endpoints/config');
var datacenters = require('./datacenters');
var datasets = require('./datasets');
var docs = require('./docs');
var disks = require('./endpoints/disks');
var keys = require('./keys');
var machines = require('./machines');
var migrations = require('./migrations');
var metadata = require('./metadata');
var nics = require('./nics');
var packages = require('./packages');
var services = require('./services');
var snapshots = require('./snapshots');
var tags = require('./tags');
var throttle = require('./throttle');
var networkEndpoints = require('./endpoints/networks');
var networkMiddleware = require('./middleware/networks');
var audit = require('./audit');
var auditLogger = require('./audit_logger');
var rules = require('./rules');
var volumeEndpoints = require('./endpoints/volumes');
const execEndpoints = require('./endpoints/exec');
var vnc = require('./endpoints/vnc');
var accessKeysEndpoints = require('./endpoints/accesskeys');

// Account users, roles and policies:
var users = require('./users');
var policies = require('./policies');
var roles = require('./roles');
// Account virtual resources:
var resources = require('./resources');

var APERTURE_CFG = path.join(__dirname, '..', '/etc/aperture.json');

var apertureConfig = {};
try {
    apertureConfig = JSON.parse(fs.readFileSync(APERTURE_CFG, 'utf8'));
} catch (_e) {
    apertureConfig = {
        typeTable: {
            ip: 'ip',
            requestip: 'ip',
            tag: 'string'
        }
    };
}

// PUBAPI-646: Backwards compatible authorization parser
var authorizationParser = require('./authorization');

var PluginManager = require('./plugin-manager');

// --- Globals

var VERSION = false;
var userThrottle = throttle.getUserThrottle;

// --- Internal functions

/**
 * Returns the current semver version stored in CloudAPI's package.json.
 * This is used to set in the API versioning and in the Server header.
 *
 * @return {String} version.
 */
function version() {
    if (!VERSION) {
        var pkg = fs.readFileSync(__dirname + '/../package.json', 'utf8');
        VERSION = JSON.parse(pkg).version;
    }

    return VERSION;
}




/**
 * Creates a UFDS client instance pointing to the UFDS server provided
 * in options. callback will be called either with Error - cb(err) - or
 * with the recently instantiated client object: cb(null, ufds_client)
 */
function createUfdsClient(options, callback) {
    var ufds = new UFDS(options);

    ufds.once('connect', function () {
        ufds.removeAllListeners('error');
        ufds.on('error', function (err) {
            options.log.error(err, 'UFDS disconnected');
        });
        ufds.on('connect', function () {
            options.log.info('UFDS reconnected');
        });
        callback(null, ufds);
    });

    ufds.once('error', function (err) {
        // You are screwed. It's likely that the bind credentials were bad.
        // Treat this as fatal and move on:
        options.log.error({err: err}, 'UFDS connection error');
        callback(err);
    });
}


function createHTTPClients(options) {
    var clients = {
        vmapi: new SDC.VMAPI(options.vmapi),
        napi: new SDC.NAPI(options.napi),
        fwapi: new SDC.FWAPI(options.fwapi),
        imgapi: new SDC.IMGAPI.createClient(options.imgapi),
        keyapi: new keyapi(options),
        cnapi: new SDC.CNAPI(options.cnapi),
        papi: new SDC.PAPI(options.papi),
        mahi: (options.mahi) ? mahi.createClient(options.mahi) : null,
        cns: (options.cns) ? (new SDC.CNS(options.cns)) : null
    };
    var volapiConfig;

    if (options.volapi) {
        volapiConfig = jsprim.deepCopy(options.volapi);

        volapiConfig.version = '^1';
        volapiConfig.userAgent = 'cloudapi';

        clients.volapi = new SDC.VOLAPI(volapiConfig);
    }

    return clients;
}


function createClients(options, callback) {
    assert.ok(options);
    assert.ok(options.vmapi);
    assert.ok(options.napi);
    assert.ok(options.imgapi);
    assert.ok(options.fwapi);
    assert.ok(options.papi);
    assert.ok(options.ufds);
    assert.ok(options.ufds_master);
    assert.optionalObject(options.volapi, 'options.volapi');

    var agent;
    if (options.cueballHttpAgent) {
        agent = new cueball.HttpAgent(options.cueballHttpAgent);
    }

    options.ufds.log = options.log.child({ component: 'ufds' });
    options.ufds_master.log = options.log.child({ component: 'ufds_master' });
    options.vmapi.log = options.log.child({ component: 'vmapi' });
    options.napi.log = options.log.child({ component: 'napi' });
    options.imgapi.log = options.log.child({ component: 'imgapi' });
    options.papi.log = options.log.child({ component: 'papi' });
    options.fwapi.log = options.log.child({ component: 'fwapi' });
    options.cnapi.log = options.log.child({ component: 'cnapi' });

    options.fwapi.agent = agent;
    options.cnapi.agent = agent;
    options.papi.agent = agent;
    options.napi.agent = agent;
    options.vmapi.agent = agent;
    options.imgapi.agent = agent;

    if (options.mahi) {
        options.mahi.log = options.log.child({ component: 'mahi' });
        options.mahi.typeTable = apertureConfig.typeTable;
        options.mahi.agent = agent;
    }

    if (options.cns) {
        options.cns.log = options.log.child({ component: 'cns' });
        options.cns.agent = agent;
    }

    if (options.volapi) {
        options.volapi.log = options.log.child({ component: 'volapi' });
        options.volapi.agent = agent;
    }

    // On this case, we'll point pkg and ufds to the same UFDS server,
    // given we're running into "ufds-master" headnode
    var ufds_is_master = (options.ufds_master.url === 'ldaps://');

    // Single ufds server
    if (ufds_is_master) {
        createUfdsClient(options.ufds, function (err, ufds) {
            if (err) {
                return callback(err);
            }
            var clients = createHTTPClients(options);
            clients.ufds = ufds;
            clients.ufds_master = ufds;
            clients.is_ufds_master = true;
            return callback(null, clients);
        });
    } else {
        // Master and HN local UFDS servers:
        createUfdsClient(options.ufds_master, function (err, ufds_master) {
            if (err) {
                return callback(err);
            }
            return createUfdsClient(options.ufds, function (err2, ufds) {
                if (err2) {
                    return callback(err2);
                }
                var clients = createHTTPClients(options);
                clients.ufds = ufds;
                clients.ufds_master = ufds_master;
                clients.is_ufds_master = false;
                return callback(null, clients);
            });
        });
    }
}


// --- API

module.exports = {

    createServer: function (config, callback) {
        var log = config.log;
        var globalAgentInterval;
        var server;
        var machineThrottle;

        config.name = 'cloudapi/' + version();
        // API version and package.json version are separate; see RFD 68
        // for more details
        config.version = ['9.0.0', '8.0.0', '7.3.0', '7.2.0', '7.1.0', '7.0.0'];

        if (config.dc_maint_eta) {
            var d = new Date(config.dc_maint_eta);
            if (d.toString() !== 'Invalid Date') {
                config.dcMaintUtcEta = d.toUTCString();
            }
        }

        config.handleUpgrades = true;

        var kangOpts = cueball.poolMonitor.toKangOptions();
        kangOpts.port = config.port + 1010;
        /*
         * Note that we can't use kang.knStartServer here, as kang's restify
         * version does not match ours and the two will clobber each other.
         */
        var kangServer = restify.createServer({ serverName: 'Kang' });
        kangServer.get(new RegExp('.*'), kang.knRestifyHandler(kangOpts));
        kangServer.listen(kangOpts.port, '127.0.0.1', function () {
            log.info('cueball kang monitor started on port %d', kangOpts.port);
        });

        var metricsManager = createMetricsManager({
            address: config.adminIp,
            log: log.child({ component: 'metrics' }),
            port: config.port + 800,
            restify: restify,
            staticLabels: {
                datacenter: config.datacenter_name,
                instance: config.instanceUuid,
                port: config.port,
                server: config.serverUuid,
                service: config.serviceName
            }
        });

        metricsManager.createRestifyMetrics();
        metricsManager.listen(function () {});

        return createClients(config, function (error, clients) {
            if (error) {
                log.error({err: error}, 'Create clients error');
                throw error;
            }
            // ufds client itself comes plenty of listeners to buble up
            // ldap client events. Let's sightly increase limits
            clients.ufds.setMaxListeners(15);
            clients.ufds.on('timeout', function (msg) {
                log.warn({message: msg},
                    'local UFDS client timeout (recycling)');
                // server.emit('uncaughtException', req, res, null,
                //    new restify.InternalError('Backend Timeout Error'));
                try {
                    clients.ufds.client.socket.destroy();
                } catch (e) {
                    log.fatal({err: e},
                        'could not destroy the timed out local UFDS socket');
                }
            });

            if (!clients.is_ufds_master) {
                clients.ufds_master.setMaxListeners(15);
                clients.ufds_master.on('timeout', function (msg) {
                    log.warn({message: msg},
                        'UFDS Master client timeout (recycling)');
                    // server.emit('uncaughtException', req, res, null,
                    //    new restify.InternalError('Backend Timeout Error'));
                    try {
                        clients.ufds.client.socket.destroy();
                    } catch (e) {
                        log.fatal({err: e},
                        'could not destroy the timed out master UFDS socket');
                    }
                });
            }

            config.handleUpgrades = true;

            server = restify.createServer(config);

            server.use(restify.acceptParser(server.acceptable));
            server.use(authorizationParser());
            server.use(restify.dateParser());
            server.use(restify.requestLogger());
            server.use(restify.queryParser({
                allowDots: false,
                plainObjects: false
            }));
            server.use(restify.bodyParser({
                overrideParams: true,
                mapParams: true,
                maxBodySize: 100000
            }));
            server.use(restify.fullResponse());

            server.use(function xForwardedFor(req, res, next) {
                // Stolen from muskie!:
                // This will only be null on the _first_ request, and in
                // that instance, we're guaranteed that HAProxy sent us
                // an X-Forwarded-For header

                var conn = req.connection;
                if (!conn._xff) {
                    // Clean up clientip if IPv6
                    var xff = req.headers['x-forwarded-for'];
                    if (xff) {
                        /* JSSTYLED */
                        xff = xff.split(/\s*,\s*/).pop() || '';
                        xff = xff.replace(/^(f|:)+/, '');
                        conn._xff = xff;
                    } else {
                        conn._xff = conn.remoteAddress;
                    }
                }
                return next();
            });

            // docs handler here has to run before auth stuff
            docs.mount(server);

            var plugins = new PluginManager({
                log: log,
                config: config,
                clients: clients
            });

            server.feed = new changefeed.Feed({
                log: log,
                config: config
            });

            server.use(function setupSDCProxies(req, res, next) {
                req.config = config;
                req.config.apertureConfig = apertureConfig;
                req.sdc = clients;
                req.plugins = plugins;
                req.feed = server.feed;
                return next();
            });

            // Account management feature, added at version 7.2.0,
            // requires both, the proper req.version and a configured
            // mahi instance. Additionally, it'll require the feature
            // added to bleeding_edge_features until it's out of beta:
            server.use(function accountMgmt(req, res, next) {
                var v = req.getVersion();
                if (req.sdc.mahi &&
                    (semver.satisfies('7.2.0', v) ||
                    semver.ltr('7.2.0', v))) {
                    req.accountMgmt = true;
                }
                return next();
            });

            // Run authentication and authorization before everything else
            server.use(auth.preSignedUrl);
            server.use(auth.signatureAuth);
            server.use(auth.tokenAuth);
            server.use(auth.assertAuthenticated);
            server.use(auth.loadAccount);
            if (config.account_allowed_dcs) {
                server.use(auth.authnAllowedDcs);
            }

            server.use(resources.resourceName);

            server.use(datasets.loadDatasets);
            server.use(packages.loadPackages);
            server.use(networkMiddleware.loadNetworks);
            server.use(machines.loadMachine);

            server.use(resources.loadResource);

            // req.routename will be used to GRANT/DENY access using
            // policies rules. It must be called before auth.authorize.
            server.use(function reqRoutename(req, res, next) {
                var resourceTagRoutes = [
                    'replaceaccountroletags',
                    'replaceresourcesroletags',
                    'replaceuserkeysresourcesroletags',
                    'replaceresourceroletags',
                    'replacemachineroletags',
                    'replaceuserkeysresourceroletags'
                ];

                if (req.route.name !== 'updatemachine') {
                    if (resourceTagRoutes.indexOf(req.route.name) !== -1) {
                        req.routename = 'setroletags';
                    } else {
                        req.routename = req.route.name;
                    }
                } else {
                    switch (req.params.action) {
                    case 'enable_firewall':
                        req.routename = 'enablemachinefirewall';
                        break;
                    case 'disable_firewall':
                        req.routename = 'disablemachinefirewall';
                        break;
                    default:
                        req.routename = req.params.action + 'machine';
                        break;
                    }
                }
                return next();
            });

            server.use(auth.authorize);

            server.use(function readOnlyMode(req, res, next) {
                var mthd = req.method;

                if ((mthd === 'PUT' || mthd === 'POST' || mthd === 'DELETE') &&
                    req.config.read_only === true) {
                    if (req.config.dcMaintUtcEta) {
                        res.setHeader('Retry-After', req.config.dcMaintUtcEta);
                    }

                    var msg = req.config.dc_maint_message ||
                        'This Triton data center is being upgraded';

                    return next(new restify.ServiceUnavailableError(msg));
                }

                return next();
            });

            // Save Context for Machines Audit:
            server.use(function saveContext(req, res, next) {
                if (!/\/machines/.test(req.getUrl().pathname)) {
                    return next();
                }

                if (req.method !== 'PUT' && req.method !== 'POST' &&
                    req.method !== 'DELETE') {
                    return next();
                }

                var authType = 'signature';

                if (req.authorization.scheme.toLowerCase() === 'basic') {
                    authType = 'basic';
                }

                if (typeof (req.headers['X-Auth-Token']) !== 'undefined') {
                    authType = 'token';
                }

                req._auditCtx = {
                    type: authType,
                    ip: req.connection.remoteAddress
                };

                if (authType === 'basic') {
                    req._auditCtx.user = req.caller.login;
                } else if (req.authorization.signature) {
                    req._auditCtx.keyId =
                        req.authorization.signature.keyId;
                }

                return next();
            });

            // Now mount all the API handlers. Images, packages and networks are
            // first:
            datasets.mount(server, userThrottle(config, 'datasets'), config);
            packages.mount(server, userThrottle(config, 'packages'));
            networkEndpoints.mount(server, userThrottle(config, 'networks'));

            // Wait for datasets and packages to mount everything else:
            account.mount(server, userThrottle(config, 'account'));
            datacenters.mount(server, userThrottle(config, 'datacenter'));
            services.mount(server, userThrottle(config, 'services'));
            keys.mount(server, userThrottle(config, 'keys'), config);

            machineThrottle = userThrottle(config, 'machines');
            machines.mount(server, machineThrottle);
            changefeed.mount(server, userThrottle(config, 'changefeed'));
            metadata.mount(server, machineThrottle);
            migrations.mount(server, machineThrottle);
            snapshots.mount(server, machineThrottle);
            disks.mount(server, machineThrottle);
            tags.mount(server, machineThrottle);
            audit.mount(server, machineThrottle);
            rules.mount(server, machineThrottle);
            execEndpoints.mount(server, machineThrottle);

            vnc.mount(server, machineThrottle);

            users.mount(server, userThrottle(config, 'users'), config);
            policies.mount(server, userThrottle(config, 'policies'), config);
            roles.mount(server, userThrottle(config, 'roles'), config);
            nics.mount(server, userThrottle(config, 'nics'));
            configEndpoints.mount(server, userThrottle(config, 'config'));
            resources.mount(server, userThrottle(config, 'resources'), config);

            if (config.experimental_cloudapi_nfs_shared_volumes === true) {
                volumeEndpoints.mount(server, userThrottle(config, 'volumes'));
            }

            accessKeysEndpoints.mount(server,
                userThrottle(config, 'accesskeys'), config);

            server.on('after', auditLogger({
                log: log.child({component: 'audit'})
            }));

            server.on('after', metricsManager.collectRestifyMetrics
                .bind(metricsManager));

            // Closure to wrap up the port setting
            server.start = function start(cb) {
                if (config.read_only === true) {
                    log.warn('Starting Cloud API on read only mode.');
                }
                return server.listen(config.port, cb);
            };

            // Setup a logger on HTTP Agent queueing
            globalAgentInterval = setInterval(function () {
                var httpReqs = http.globalAgent.requests;
                if (httpReqs && httpReqs.length > 0) {
                    log.warn('http.globalAgent queueing, depth=%d',
                        httpReqs.length);
                }

                var httpsReqs = https.globalAgent.requests;
                if (httpsReqs && httpsReqs.length > 0) {
                    log.warn('https.globalAgent queueing, depth=%d',
                                httpsReqs.length);
                }
            }, 1000);

            // If we make JSON main format, res.send(error) will send our
            // Restify formatted error objects, and properly hide the v8
            // backtrace.
            server.acceptable.unshift('application/json');

            server.on('close', function () {
                clearInterval(globalAgentInterval);

                kangServer.close();
                metricsManager.close(function () {});

                clients.vmapi.close();
                clients.napi.close();
                clients.fwapi.close();
                clients.imgapi.close();
                clients.papi.close();
                clients.cnapi.close();

                if (clients.mahi) {
                    clients.mahi.close();
                }

                if (clients.cns) {
                    clients.cns.close();
                }

                if (clients.volapi) {
                    clients.volapi.close();
                }

                process._getActiveHandles().forEach(function (h) {
                    return h.unref && h.unref();
                });

                clients.ufds.close(function (err) {
                    if (err) {
                        throw err;
                    }

                    if (!clients.ufds_master.closed) {
                        clients.ufds_master.close(function (err2) {
                            if (err2) {
                                throw err2;
                            }
                        });
                    }
                });
            });

            server.on('uncaughtException', function (req, res, _route, err) {
                var e = new restify.InternalError('Internal Error');
                req.log.error(err, 'unexpected error');
                res.send(e);
            });

            server._clients = clients;
            return callback(null, server);
        });
    }
};
