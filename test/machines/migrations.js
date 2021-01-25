/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 */

var restify = require('restify');

var common = require('../common');
var checkHeaders = common.checkHeaders;
var checkNotFound = common.checkNotFound;

var waitForJob = require('./common').waitForJob;

// --- Helpers


function checkMigration(t, migration) {
    t.ok(migration, 'migration ok');
    // Prevent exceptions when migration is not Ok
    if (!migration) {
        return;
    }
    t.ok(migration.machine, 'migration machine ok');
    t.ok(migration.state, 'migration state ok');
    t.ok(migration.phase, 'migration phase ok');
    t.ok(migration.created_timestamp, 'migration created_timestamp ok');
}


// --- Tests


module.exports = function migrate(suite, client, other, machine, callback) {
    if (!machine) {
        callback();
        return;
    }

    var migrationFailed = false;

    var httpClient = restify.createHttpClient({
        url: client.url.href,
        version: client.headers['accept-version'],
        retryOptions: {
            retry: 0
        },
        log: client.log,
        rejectUnauthorized: false,
        signRequest: client.signRequest
    });
    httpClient.keyId = client.keyId;
    httpClient.privateKey = client.privateKey;
    httpClient.publicKey = client.publicKey;

    var watcher = {
        done: false,
        started: false,
        error: null,
        events: []
    };


    function watch() {
        watcher.done = false;

        var p = '/my/machines/' + machine + '/migrate?action=watch';

        httpClient.post(p, function reqCb(reqErr, req) {
            if (reqErr) {
                watcher.error = reqErr;
                watcher.done = true;
                return;
            }

            req.on('result', function resultCb(resErr, res) {
                if (resErr) {
                    watcher.error = resErr;
                    watcher.done = true;
                    return;
                }

                res.body = '';
                res.setEncoding('utf8');
                res.on('data', function onDataCb(chunk) {
                    res.body += chunk;
                });

                res.on('end', function onEndCb() {
                    res.body = res.body.trim().split('\n')
                        .map(function toJson(chunk) {
                            return JSON.parse(chunk);
                        });

                    watcher.events.push(res.body);
                    watcher.done = true;
                });
            });

            req.end();
        });
    }

    suite.test('estimate migration', function (t) {
        var url = '/my/machines/' + machine + '/migrate';
        client.get(url, function getEstimateCb(err, req, res, body) {
            t.ifError(err, 'migration estimate error');
            t.ok(body, 'migration estimate');
            t.ok(body.size, 'migration size');
            // TODO: Add other estimation fields when added
            t.end();
        });
    });


    var actions = ['begin', 'abort', 'begin', 'sync', 'sync', 'switch'];

    actions.forEach(function testMigrationAction(action) {
        suite.test(action + ' migration', function actionMigrCb(t) {
            if (migrationFailed) {
                t.end();
                return;
            }
            var url = '/my/machines/' + machine + '/migrate';
            client.post(url, {
                action: action
            }, function doPostCb(err, req, res, body) {
                t.ifError(err);
                if (err) {
                    migrationFailed = true;
                    t.end();
                    return;
                }
                t.equal(res.statusCode, 201);
                checkHeaders(t, res.headers);
                t.ok(body);
                checkMigration(t, body);
                if (!watcher.started) {
                    watcher.started = true;
                }
                watch();
                t.end();
            });
        });

        suite.test('Wait for migrate ' + action, function waitTest(t) {
            if (migrationFailed) {
                t.end();
                return;
            }
            client.vmapi.listJobs({
                vm_uuid: machine,
                task: 'migrate-' + action
            }, function listJobsCb(err, jobs) {
                t.ifError(err, 'list jobs error');
                t.ok(jobs, 'list jobs OK');
                t.ok(jobs.length, 'migrate jobs is array');
                var migrate_job = jobs[0];
                waitForJob(client, migrate_job.uuid, function waitCb(err2) {
                    if (err2) {
                        migrationFailed = true;
                    }
                    t.ifError(err2, 'Check state error');
                    t.end();
                });
            });
        });

        suite.test('Check watcher entries after ' + action, function wCb(t) {
            var count = 0;
            var maxSecs = 5 * 60; // 5 minutes

            function waitForWatcherEnd() {
                count += 5;
                if (!watcher.done) {
                    if (count > maxSecs) {
                        t.ok(false, 'Timed out waiting for the watcher to end');
                        t.end();
                        return;
                    }
                    setTimeout(waitForWatcherEnd, 5000);
                    return;
                }

                var events = watcher.events.pop();
                if (events) {
                    t.ok(events.length > 0, 'Should have seen events');
                    var endEvent = events.filter(function filterEnd(evt) {
                        return evt.type === 'end';
                    })[0];
                    t.ok(endEvent, 'Should have seen end event');
                    t.equal(endEvent.phase, action, 'Phase should be ' +
                        action);
                    var progressEvents = events.filter(
                        function filterProgr(evt) {
                        return evt.type === 'progress';
                    });
                    progressEvents.forEach(function testPrgrEvt(evt) {
                        t.ok(evt.current_progress,
                            'Should have current_progress');
                        t.ok(evt.state, 'Should have event state');
                        t.ok(evt.total_progress, 'Should have total_progress');
                        if (evt.started_timestamp) {
                            t.ok(evt.duration_ms,
                            'Should have duration_ms and started_timestamp');
                        }
                    });
                }
                t.end();
            }

            waitForWatcherEnd();
        });

        suite.test('List migrations after ' + action, function lsCb(t) {
            var url = '/my/migrations';
            // Should get at least a migration.
            client.get(url, function listCb(err, req, res, body) {
                t.ifError(err, 'list migrations error');
                t.ok(body, 'migrations list');
                t.ok(body.length, 'migrations length');
                checkMigration(t, body[0]);
                t.end();
            });
        });

        suite.test('Get migration after ' + action, function gCb(t) {
            var url = '/my/migrations/' + machine;
            client.get(url, function getCb(err, req, res, body) {
                t.ifError(err, 'get migration error');
                t.ok(body, 'migration');
                checkMigration(t, body);
                t.end();
            });
        });
    });

    suite.test('List migrations other', function (t) {
        other.get('/my/migrations', function otherLsCb(err, req, res, body) {
            t.ifError(err);
            t.deepEqual(body, []);
            t.end();
        });
    });

    suite.test('Get migration other', function (t) {
        var p = '/my/migrations/' + machine;
        other.get(p, function otherGetCb(err, req, res, body) {
            checkNotFound(t, err, req, res, body);
            t.end();
        });
    });

    suite.test('Finalize migration', function finalizeMigrCb(t) {
        if (migrationFailed) {
            t.end();
            return;
        }
        var url = '/my/machines/' + machine + '/migrate';
        client.post(url, {
            action: 'finalize'
        }, function doPostCb(err, req, res) {
            t.ifError(err);
            if (err) {
                t.end();
                return;
            }

            t.equal(res.statusCode, 200);
            t.end();
        });
    });

    suite.test('Close migrations watch client', function closeTest(t) {
        httpClient.close();
        t.end();
    });

    callback();
};
