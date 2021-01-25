/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Author: Alex Wilson <alex@uq.edu.au>
 * Copyright 2019, The University of Queensland
 * Copyright 2020 Joyent, Inc.
 */

const net = require('net');

const assert = require('assert-plus');
const restify = require('restify');


function execCommand(req, res, next) {
    const vm = req.machine;

    if (['joyent', 'joyent-minimal', 'lx'].indexOf(vm.brand) === -1) {
        res.send(400, new restify.RestError({
            statusCode: 400,
            restCode: 'MachineIsHVM',
            message: 'Specified machine is an HVM and cannot execute commands'
        }));
        next();
        return;
    }

    if (vm.state !== 'running') {
        res.send(400, new restify.RestError({
            statusCode: 400,
            restCode: 'MachineStopped',
            message: 'Only running machines can execute commands'
        }));
        next();
        return;
    }

    if (!req.params.argv || !Array.isArray(req.params.argv)) {
        res.send(400, new restify.RestError({
            statusCode: 400,
            restCode: 'InvalidArgument',
            message: 'The "argv" parameter is required and must be an Array'
        }));
        next();
        return;
    }

    req.sdc.cnapi.dockerExec(vm.compute_node, vm.id, {
        'command': {
            'Cmd': req.params.argv
        }
    }, function afterDockerExec(err, info) {
        if (err) {
            req.log.error(err, 'failed to start exec job');
            res.send(500, new restify.InternalServerError('Failed to ' +
                'execute command'));
            next();
            return;
        }

        req.log.debug({ info: info }, 'exec job got connection info');

        const sock = net.createConnection({
            host: info.host,
            port: info.port
        });

        sock.once('connect', function () {
            res.header('content-type', 'application/x-json-stream');
            sock.pipe(res);
            sock.once('end', function () {
                next();
                return;
            });
        });

        sock.once('error', function (sockErr) {
            req.log.error(sockErr, 'error from exec job socket');
            res.send(500, new restify.InternalServerError('Failed to ' +
                'execute command'));
            next();
            return;
        });
    });
}

function mount(server, before, pre) {
    assert.object(server, 'server');
    assert.ok(before, 'before');
    assert.optionalArrayOfFunc(pre, 'pre');

    pre = pre || [];

    server.post({
        path: '/:account/machines/:machine/exec',
        name: 'ExecMachineCommand',
        version: [ '9.14.0' ]
    }, before, execCommand);

    return server;
}

module.exports = {
    mount: mount
};
