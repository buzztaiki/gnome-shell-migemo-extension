//-*- mode:js; js-indent-level: 4-*-
const St = imports.gi.St;
const Mainloop = imports.mainloop;

const Main = imports.ui.main;
const Search = imports.ui.search;
const AppDisplay = imports.ui.appDisplay;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;

const MIGEMO = '/usr/bin/cmigemo';
const MIGEMO_DICT = '/usr/share/cmigemo/utf-8/migemo-dict';
const MIGEMO_MIN_TERMS = 2;

// Put your extension initialization code here
function main() {

    let migemo = new MigemoSearchProvider();

    Main.overview.viewSelector.addSearchProvider(migemo);

    Search.SearchSystem.prototype.updateSearch_orig = Search.SearchSystem.prototype.updateSearch;
    Search.SearchSystem.prototype.updateSearch = function(searchString){
        let results = this.updateSearch_orig(searchString);
        let res = migemo.getResultSet(searchString);
        if(res.length > 0){
            results.push([migemo, res]);
        }
        return results;
    }
}

function MigemoSearchProvider() {
    this._init();
}

MigemoSearchProvider.prototype = {
    __proto__: AppDisplay.BaseAppSearchProvider.prototype,

    _init: function() {
        AppDisplay.BaseAppSearchProvider.prototype._init.call(this, "migemo");
        this._migemo = new Migemo(MIGEMO, MIGEMO_DICT);
    },

    getInitialResultSet: function(terms) {
        // dummy
        return [];
    },

    getSubsearchResultSet: function(previousResults, terms) {
        // dummy
        return [];
    },

    getResultSet: function(terms) {
        if (terms.length < MIGEMO_MIN_TERMS) { return []; }

        let searchString = this._migemo.query(terms);
        global.log(searchString);

        let regexp = new RegExp(searchString);
        let apps = this._appSys.get_flattened_apps(); // get all apps
        return apps.filter(function(app){
            return -1 < app.get_name().search(regexp);
        }).map(function(app){
            return app.get_id();
        });
    },

    createResultActor: function (resultMeta, terms) {
        let app = this._appSys.get_app(resultMeta['id']);
        let icon = new AppDisplay.AppWellIcon(app);
        return icon.actor;
    }
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
        this._stdin.put_string(query + '\n', null);
        // XXX: Want to use cancellable.
        let [out, size] = this._stdout.read_line(null);
        return out;
    }
};
