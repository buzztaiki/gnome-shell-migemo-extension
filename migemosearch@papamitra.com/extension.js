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

/**
 * Migemo application search provider for gnome-3.2 and later.
 */
function MigemoSearchProvider(migemo) {
    this._init(migemo);
}

MigemoSearchProvider.prototype = {
    __proto__: Search.SearchProvider.prototype,

    _init: function(migemo) {
        Search.SearchProvider.prototype._init.call(this, 'migemo');
        this._migemo = migemo;
        this._appSys = Shell.AppSystem.get_default();
        this._appSearch = new AppDisplay.AppSearchProvider();

        let self = this;
        ['getResultMeta', 'activateResult', 'dragActivateResult', 'createResultActor',].forEach(function(x) {
            self[x] = function() {
                return self._appSearch[x].apply(self._appSearch, arguments);
            };
        });
    },

    getInitialResultSet: function(terms) {
        return this._getResultSet(null, terms);
    },

    getSubsearchResultSet: function(previousResults, terms) {
        return this._getResultSet(previousResults, terms);
    },

    _getResultSet: function(previousResults, terms) {
        let searchString = terms.join(' ');
        if (searchString.length < MIGEMO_MIN_LENGTH) {
            let result = [];
            result.pendingMigemo = true;
            return result;
        } else if (previousResults == null || previousResults.pendingMigemo || searchString.length == MIGEMO_MIN_LENGTH) {
            return this._reduceResults(
                this._search(searchString, this._appSys.get_all()),
                this._appSearch.getInitialResultSet(terms));
        } else {
            return this._reduceResults(
                this._search(searchString, previousResults),
                this._appSearch.getSubsearchResultSet(previousResults, terms));
        }
    },

    _reduceResults: function(results, appResults) {
        let appNames = appResults.map(function(app) {
            return app.get_name();
        });
        return results.filter(function(app) {
            return appNames.indexOf(app.get_name()) < 0;
        });
    },

    _search: function(searchString, apps) {
        if (searchString.length < MIGEMO_MIN_LENGTH || apps.length == 0) {
            return [];
        }
        let queryResult = this._migemo.query(searchString);
        let regexp = new RegExp(queryResult);
        return apps.filter(function(app) {
            return -1 < app.get_name().search(regexp);
        });
    },
};

/**
 * Migemo application search provider for gnome-3.0
 */
function MigemoSearchProvider_30() {
    this._init();
}

MigemoSearchProvider_30.prototype = {
    __proto__: (function() {
        if ('BaseAppSearchProvider' in AppDisplay) {
            return AppDisplay.BaseAppSearchProvider.prototype;
        } else {
            return {};
        }
    })(),

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
        if (terms.length < MIGEMO_MIN_LENGTH) {
            return [];
        }

        let searchString = this._migemo.query(terms);
        let regexp = new RegExp(searchString);
        let apps = this._appSys.get_flattened_apps(); // get all apps
        return apps.filter(function(app) {
            return -1 < app.get_name().search(regexp);
        }).map(function(app) {
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
    let migemoProvider = new MigemoSearchProvider_30();

    Main.overview.viewSelector.addSearchProvider(migemoProvider);

    Search.SearchSystem.prototype.updateSearch_orig = Search.SearchSystem.prototype.updateSearch;
    Search.SearchSystem.prototype.updateSearch = function(searchString) {
        let results = this.updateSearch_orig(searchString);
        let resultIds = results.reduce(function(acc, [provider, providerResults]) {
            return acc.concat(providerResults);
        }, []);
        let res = migemoProvider.getResultSet(searchString).filter(function(id) {
            return resultIds.indexOf(id) < 0;
        });
        if(res.length > 0) {
            results.push([migemoProvider, res]);
        }
        return results;
    }
}
