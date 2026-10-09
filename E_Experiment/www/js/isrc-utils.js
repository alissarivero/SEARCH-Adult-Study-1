/**
 * isrcUtils
 */
var isrcUtils = {


    /**
     * Properties
     */
    buttons: [],
    preloadedImages: [],
    initialTimeStamp: null,
    data: {
        'uid': 0,
        'duration': 0,
        'date': null,
    },




    /**
     * Run fn once Cordova is ready (or immediately in browser).
     * Handles deviceready firing before this script loads.
     */
    whenCordovaReady: function (fn) {
        if (typeof fn !== "function") return;
        if (window.cordova && window.cordova.platformId) {
            fn();
            return;
        }
        document.addEventListener("deviceready", fn, false);
    },


    /**
     * Cordova: initialize()
     */
    initialize: function () {
        var self = this;
        self.whenCordovaReady(function () {
            self.receivedEvent("deviceready");
        });
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", function () {
                if (!window.cordova) self.receivedEvent("deviceready");
            }, false);
        } else if (!window.cordova) {
            self.receivedEvent("deviceready");
        }
    },


    /**
     * Cordova: receivedEvent()
     */
    receivedEvent: function (id) {

        switch (id) {
            case 'deviceready':
                this.Setup();
                this.SetHandlers();
                if (typeof bootGridSearchAfterCordova === "function") {
                    bootGridSearchAfterCordova();
                } else {
                    document.addEventListener("DOMContentLoaded", function () {
                        if (typeof bootGridSearchAfterCordova === "function") {
                            bootGridSearchAfterCordova();
                        }
                    }, false);
                }
                break;
        }


    },


    /**
     * Setup()
     */
    Setup: function () {

        // Immersive mode (Android only; skip on iOS / browser)
        try {
            if (typeof AndroidFullScreen !== 'undefined' && AndroidFullScreen.immersiveMode) {
                AndroidFullScreen.immersiveMode();
            }
        } catch (e) {
            console.warn('AndroidFullScreen skipped:', e);
        }

        // Routes setup
        var routes = document.querySelectorAll('div.route');
        for (var i = 0; i < routes.length; ++i) {
            routes[i].style.display = 'none';
        }
        var route = document.getElementById('rt-start');
        if (route) route.style.display = 'block';

        // Routes buttons setup
        var buttons = document.querySelectorAll('button[data-href]'),
            i;
        for (i = 0; i < buttons.length; ++i) {
            buttons[i].addEventListener('click', isrcUtils.ButtonGoto);
        }

        // Enter pinned mode
        //isrcUtils.enterPinnedMode();

        // Setup DB
        //isrcUtils.SetupDb();

        // Set counter
        if (localStorage.getItem("isrc-utils-counter") === null) {
            localStorage.setItem("isrc-utils-counter", 0);
        }
        else {
            var count = parseInt(localStorage.getItem("isrc-utils-counter"));
            localStorage.setItem("isrc-utils-counter", count + 1);
        }

    },


    /**
     * SetHandlers()
     */
    SetHandlers: function () {

        isrcUtils.buttons[0] = document.getElementById('btn-initial-form');
        if (isrcUtils.buttons[0] && isrcUtils.buttons[0].dataset.isrcBound !== '1') {
            isrcUtils.buttons[0].dataset.isrcBound = '1';
            isrcUtils.buttons[0].addEventListener('click', isrcUtils.InitialFormSubmit);
        }

        // btn-app-restart is bound in gridSearch.js (bindRestartButton) to avoid duplicate handlers.

        isrcUtils.buttons[2] = document.getElementById('stats-records');
        if (isrcUtils.buttons[2] && isrcUtils.buttons[2].dataset.isrcBound !== '1') {
            isrcUtils.buttons[2].dataset.isrcBound = '1';
            isrcUtils.buttons[2].addEventListener('click', isrcUtils.SaveDataToFileDialog);
        }

    },


    /**
	 * enterPinnedMode()
	 */
	enterPinnedMode() {
		if (typeof cordova !== 'undefined') {
			cordova.plugins.screenPinning.enterPinnedMode(
				function () { console.log('entered pinned mode') },
				function (error) { console.log('error when entering pinned mode: ' + error) },
				true
			);
		}
	},


    /**
     * SetupDb()
    //Specific to tablet. Removed for publication
    SetupDb: function () {

        isrcUtils.db = window.sqlitePlugin.openDatabase({
            name: 'data.db',
            location: 'default'
        });

        isrcUtils.db.transaction(function (tx) {
            tx.executeSql('CREATE TABLE IF NOT EXISTS data (date, uid, data)');
        }, function (error) {
            console.log('Transaction ERROR: ' + error.message);
        }, function () {
            console.log('Created database table OK');
            isrcUtils.GetStats();
        });
    },
     */


    /**
     * InitialFormSubmit()
     */
    InitialFormSubmit: function () {
        var input = document.getElementById('uid-input');
        if (!input || input.value == null || input.value === "") return;

        isrcUtils.data.uid = input.value;
        isrcUtils.initialTimeStamp = new Date();

        var topbarUid = document.getElementById('user-id');
        if (topbarUid) topbarUid.innerHTML = 'User ID: ' + isrcUtils.data.uid;

        if (typeof clickStart === 'function') {
            clickStart('rt-start', 'page1');
            return;
        }

        var rtStart = document.getElementById('rt-start');
        if (rtStart) rtStart.style.display = 'none';
        var page1 = document.getElementById('page1');
        if (page1) page1.style.display = 'block';
    },


    /**
     * ButtonGoto()
     */
    ButtonGoto: function (evt) {
        var href = evt.target.getAttribute('data-href');
        isrcUtils.Goto(href);
        return true;
    },


    /**
     * Goto()
     */
    Goto: function (href) {
        var route = document.getElementById(href);
        if (route != null) {
            var routes = document.querySelectorAll('div.route'),
                i;
            for (i = 0; i < routes.length; ++i) {
                routes[i].style.display = 'none';
            }
            route.style.display = 'block';
        }
    },


    /**
     * GetCounter()
     */
    GetCounter: function () {
        if (localStorage.getItem("isrc-utils-counter") === null)
            return 0;
        else
            return localStorage.getItem("isrc-utils-counter");
    },


    /**
     * ArrayShuffle()
     */
    ArrayShuffle: function (array) {
        var currentIndex = array.length,
            temporaryValue, randomIndex;

        // While there remain elements to shuffle...
        while (0 !== currentIndex) {

            // Pick a remaining element...
            randomIndex = Math.floor(Math.random() * currentIndex);
            currentIndex -= 1;

            // And swap it with the current element.
            temporaryValue = array[currentIndex];
            array[currentIndex] = array[randomIndex];
            array[randomIndex] = temporaryValue;
        }

        return array;
    },


    /**
     * ImagesPreload()
     */
    PreloadImages: function (images) {
        var baseIndex = isrcUtils.preloadedImages.length - 1;
        for (var i = 0; i < images.length; i++) {
            isrcUtils.preloadedImages[baseIndex + i] = new Image();
            isrcUtils.preloadedImages[baseIndex + i].src = images[i];
        }
    },


    /**
     * SaveAndEnd()
     */
    SaveAndEnd: function (stimuliData) {
        // merge data from stimuli
        isrcUtils.data = isrcUtils.ExtendObject(isrcUtils.data, stimuliData);
        if (typeof hideAllExperimentPages === 'function') hideAllExperimentPages();
        isrcUtils.Goto('rt-end');
        isrcUtils.SaveData();
    },


    /**
     * Restart()
     */
    Restart: function (evt) {
        if (evt && evt.preventDefault) evt.preventDefault();
        if (typeof restartApp === 'function') {
            restartApp();
            return;
        }
        try {
            window.location.href = window.location.pathname + window.location.search;
        } catch (e) {
            window.location.reload();
        }
    },


    /**
     * SaveData()
     */
    SaveData: function() {

        var currentTimeStamp = new Date();
        isrcUtils.data.date = currentTimeStamp;
        isrcUtils.data.duration =
            isrcUtils.initialTimeStamp != null
                ? (currentTimeStamp - isrcUtils.initialTimeStamp) / 1000
                : 0;
       

        console.log('# Saving Data...');
        console.log(isrcUtils.data);

        isrcUtils.SaveDataToDb();

        isrcUtils.PrintDataDebug();
        
    },


    /**
     * SaveDataToDb — local backup (SQLite path removed for publication).
     */
    SaveDataToDb: function () {
        try {
            localStorage.setItem("gridsearch-last-data", JSON.stringify(isrcUtils.data));
        } catch (e) {
            console.log("localStorage save failed: " + e);
        }
        var debugOut = document.getElementById("debug-out");
        if (debugOut) {
            debugOut.innerHTML =
                (debugOut.innerHTML || "") +
                '<br><span style="color:#6fcf6f">Session saved locally.</span>';
        }
    },


    /**
     * GetStats()
     */
    GetStats: function () {
        isrcUtils.db.transaction(function (tx) {
            tx.executeSql('SELECT count(*) AS mycount FROM data', [], function (tx, res) {
                if (res.rows.length > 0) {
                    var records = res.rows.item(0).mycount;
                    var statsRecords = document.getElementById('stats-records');
                    if (statsRecords) statsRecords.innerHTML = 'Records in DB: ' + records;
                }
            }, function (error) {
                console.log('SELECT SQL statement ERROR: ' + error.message);
            });


        }, function (error) {
            console.log('Transaction ERROR: ' + error.message);
        }, function () {

        });
    },


    /**
     * DebugData()
     * Debugs data from DB in js console
     */
    DebugData: function () {
        console.log('# Debug data');
        var arr = [];
        isrcUtils.db.executeSql('SELECT * FROM data', [], function (res) {
            if (res.rows.length > 0) {
                for (var i = res.rows.length - 1; i >= 0; i--) {
                    arr.push(res.rows.item(i));
                }
            }
            console.log('[DEBUG] DATA FROM DB:');
            //console.log(arr);
            for (var i = 0; i <= arr.length; i++) {
                console.log('#### uid: ' + arr[i].uid + ' on date: ' + arr[i].date + ' ####');
                console.log(JSON.parse(arr[i].data));
            }
        }, function (error) {
            console.log('SELECT SQL statement ERROR: ' + error.message);
        });
    },


    /**
     * SaveDataOnline()
     */
    SaveDataOnline: function () {
        isrcUtils.db.executeSql('SELECT * FROM data', [], function (res) {
            console.log('[ONLINE SAVE DATA]');
            if (res.rows.length > 0) {
                var records = [];

                for (var i = res.rows.length - 1; i >= 0; i--) {
                    records.push({
                        'date': res.rows.item(i).date,
                        'uid': res.rows.item(i).uid,
                        'data': JSON.parse(res.rows.item(i).data)
                    });
                    //console.log(records[i]);
                }

                isrcUtils.Post("https://isearch.raimaj.me/ogisrcUtils/savedata.php", {
                    data: JSON.stringify(records)
                });

            }

        }, function (error) {
            console.log('SELECT SQL statement ERROR: ' + error.message);
        });

    },


    /**
     * SaveDataToFileDialog()
     */
    SaveDataToFileDialog: function () {
        navigator.notification.confirm(
            'Do you want to export the data to a local json file?', // message
            isrcUtils.SaveDataToFile, // callback to invoke with index of button pressed
            'Export data?', // title
            ['Yes', 'No'] // buttonLabels
        );
    },


    /**
     * SaveDataToFile()
     */
    SaveDataToFile: function (buttonIndex) {

        if (buttonIndex === 2) return;

        isrcUtils.db.executeSql('SELECT * FROM data', [], function (res) {

            if (res.rows.length > 0) {
                var records = [];

                //for (var i = 0; i < res.rows.length; i++) {
                //for (var i = res.rows.length - 1; i >= 0; i--) {
                for (var i = 0; i < res.rows.length; i++) {
                    records.push({
                        'date': res.rows.item(i).date,
                        'uid': res.rows.item(i).uid,
                        'data': JSON.parse(res.rows.item(i).data)
                    });
                    //console.log(records[i]);
                }

                // preapre data to write in file
                data = {
                    "count": records.length,
                    "records": records
                };

                // build results file name
                var currentdate = new Date();
                var day = ("0" + currentdate.getDate()).slice(-2);
                var month = ("0" + (currentdate.getMonth() + 1)).slice(-2);
                var filename = "data-" + day + month + currentdate.getFullYear() + "-" + currentdate.getHours() + currentdate.getMinutes() + ".json";
                console.log(filename);


                // access file system
                window.resolveLocalFileSystemURL(cordova.file.externalDataDirectory,
                    function (fs) {

                        // get or create results file
                        fs.getFile(filename, {
                                create: true,
                                exclusive: false
                            },
                            function (fileEntry) {
                                console.log("fileEntry is file?" + fileEntry.isFile.toString());
                                isrcUtils.WriteJsonToFile(fileEntry, JSON.stringify(data));
                            },
                            // write file error callback
                            function (evt, where) {
                                console.log("getFile error: " + where + " :");
                                console.log(JSON.stringify(evt));
                            }
                        );

                    },
                    // filesystem error callback
                    function (evt, where) {
                        console.log("Resolve filesystem error: " + where + " :");
                        console.log(JSON.stringify(evt));
                    }
                );
            }

            // SQL error callback
        }, function (error) {
            console.log('SELECT SQL statement ERROR: ' + error.message);
        });

    },


    /**
     * WriteJsonToFile
     */
    WriteJsonToFile: function (fileEntry, data) {
        fileEntry.createWriter(function (writer) {
                writer.onwriteend = function (evt) {
                    console.log("File successfully created!");
                };
                writer.write(data);
            },
            function (evt, where) {
                console.log("Error writing file " + where + " :");
                console.log(JSON.stringify(evt));
            }
        );
    },


    /**
     * DestroyDb()
     */
    DestroyDb: function () {
        window.sqlitePlugin.deleteDatabase({
                name: 'data.db',
                location: 'default'
            }, function () {
                console.log('DB deleted');
            },
            function () {
                console.log('ERROR in deleting DB');
            });
    },


     /**
     * PrintDataDebug()
     */
    PrintDataDebug: function() {
        var debugOut = document.getElementById("debug-out");
        if (!debugOut) return;
        debugOut.innerHTML =
            "DATA SAVED TO DB" + "<br>" +
            "uid: " + isrcUtils.data.uid + "<br>" +
            "";
    },


    /**
     * Post()
     */
    Post: function (path, params, method) {
        method = method || "post"; // Set method to post by default if not specified.

        // The rest of this code assumes you are not using a library.
        // It can be made less wordy if you use one.
        var form = document.createElement("form");
        form.setAttribute("method", method);
        form.setAttribute("action", path);

        for (var key in params) {
            if (params.hasOwnProperty(key)) {
                var hiddenField = document.createElement("input");
                hiddenField.setAttribute("type", "hidden");
                hiddenField.setAttribute("name", key);
                hiddenField.setAttribute("value", params[key]);

                form.appendChild(hiddenField);
            }
        }

        document.body.appendChild(form);
        form.submit();
    },


    /**
     * ExtendObject()
     */
    ExtendObject: function (obj, src) {
        for (var key in src) {
            if (src.hasOwnProperty(key)) obj[key] = src[key];
        }
        return obj;
    },


    /**
     * RequestConfirmation()
     */
    RequestConfirmation: function (handlerFunction, evt) {
        var event = evt;
        var handler = handlerFunction;
        navigator.notification.confirm(
            'Are you sure?',
            function (buttonIndex) {
                if (buttonIndex === 2) return;
                return handler(evt);
            },
            'Confirm',
            ['Yes', 'No'] 
        );
    },


}


isrcUtils.initialize();