//-*- mode:js; js-indent-level: 4-*-
const Main = imports.ui.main;
const Search = imports.ui.search;
const AppDisplay = imports.ui.appDisplay;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Shell = imports.gi.Shell;

const MIGEMO = '/usr/bin/cmigemo';
const MIGEMO_DICT = '/usr/share/cmigemo/utf-8/migemo-dict';
const MIGEMO_MIN_LENGTH = 2;

function MigemoSearchProvider(migemo) {
    this._init(migemo);
}

MigemoSearchProvider.prototype = {
    __proto__: Search.SearchProvider.prototype,

    _init: function(migemo) {
        Search.SearchProvider.prototype._init.call(this, "migemo");
        this._migemo = migemo;
        this._appSys = Shell.AppSystem.get_default();
    },

    getInitialResultSet: function(terms) {
        let results = this._getResultSet(terms.join(""));
        if (results.length == 0) {
            return results;
        }
        return this._reduceResults(results, this._appSys.initial_search(terms));
    },

    getSubsearchResultSet: function(previousResults, terms) {
        let results = this._getResultSet(terms.join(""));
        if (results.length == 0) {
            return results;
        }
        return this._reduceResults(results, this._appSys.subsearch(previousResults, terms));
    },

    _reduceResults: function(results, appResults) {
        let appNames = appResults.map(function(app) {
            return app.get_name();
        });
        return results.filter(function(app) {
            return appNames.indexOf(app.get_name()) < 0;
        });
    },

    _getResultSet: function(searchString) {
        if (searchString.length < MIGEMO_MIN_LENGTH) {
            return [];
        }

        let queryResult = this._migemo.query(searchString);
        let regexp = new RegExp(queryResult);
        let apps = this._appSys.get_all();
        return apps.filter(function(app) {
            return -1 < app.get_name().search(regexp);
        });
    },

    getResultMeta: function(app) {
        return AppDisplay.AppSearchProvider.prototype.getResultMeta.call(this, app);
    },

    activateResult: function(app, params) {
        return AppDisplay.AppSearchProvider.prototype.activateResult.call(this, app, params);
    },

    dragActivateResult: function(id, params) {
        return AppDisplay.AppSearchProvider.prototype.dragActivateResult.call(this, id, params);
    },

    createResultActor: function (resultMeta, terms) {
        return AppDisplay.AppSearchProvider.prototype.createResultActor.call(this, resultMeta, terms);
    },
};

function Migemo(migemo, migemoDict) {
    this._init(migemo, migemoDict);
}

Migemo.prototype = {
    _init: function(migemo, migemoDict) {
        let [res, pid, stdinFd, stdoutFd, stderrFd]  = GLib.spawn_async_with_pipes(
            null,
            [migemo, '-d', migemoDict, '-q', '-n'],
            null, GLib.SpawnFlags.SEARCH_PATH, null);
        if (!res) {
            throw 'Failed to spwan ' + migemo;
        }
        this._pid = pid;
        this._stdin = new Gio.DataOutputStream({
            base_stream: new Gio.UnixOutputStream({fd: stdinFd})
        });
        this._stdout = new Gio.DataInputStream({
            base_stream: new Gio.UnixInputStream({fd: stdoutFd})
        });
        global.log('migemo initialized');
    },

    query: function(query) {
        function upcaseFirst(s) {
            return s.replace(/^\w/, function(x) {return x.toUpperCase()});
        }

        this._stdin.put_string(query.split(/\s+/).map(upcaseFirst).join('') + '\n', null);
        // XXX: Want to use cancellable.
        let [out, size] = this._stdout.read_line(null);
        return out;
    },

    dispose: function() {
        GLib.spawn_close_pid(this._pid);
    },
};

function MigemoSearchExtension() {
    this._init();
}

MigemoSearchExtension.prototype = {
    _init: function() {
        // do nothing.
    },

    enable: function() {
        this._migemo = new Migemo(MIGEMO, MIGEMO_DICT);
        this._migemoProvider = new MigemoSearchProvider(this._migemo);

        Main.overview.addSearchProvider(this._migemoProvider);
    },

    disable: function() {
        Main.overview.removeSearchProvider(this._migemoProvider);
        this._migemo.dispose();
        this._migemo = null;
        this._migemoProvider = null;
    },
};

function init() {
    return new MigemoSearchExtension();
}

function main() {
}
