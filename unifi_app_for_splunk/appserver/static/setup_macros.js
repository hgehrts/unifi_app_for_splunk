/*
 * UniFi App for Splunk — Setup page logic.
 * Loads the current unifi_index / unifi_syslog_index macro definitions and
 * writes them back via the splunkd REST proxy on Save. No restart needed
 * (search macros are search-time).
 */
require(['jquery', 'splunkjs/mvc', 'splunkjs/mvc/simplexml/ready!'], function ($, mvc) {
    'use strict';

    var APP = 'unifi_app_for_splunk';
    var MACROS = ['unifi_index', 'unifi_syslog_index'];
    var FIELD = {
        unifi_index: 'unifi_index_def',
        unifi_syslog_index: 'unifi_syslog_index_def'
    };

    var service = mvc.createService({ owner: 'nobody', app: APP });

    function macroUrl(name) {
        return 'configs/conf-macros/' + encodeURIComponent(name);
    }

    function setStatus(msg, kind) {
        var el = $('#unifi_setup_status');
        el.text(msg);
        el.removeClass('ok err busy').addClass(kind || '');
    }

    // Load current definitions into the inputs.
    MACROS.forEach(function (name) {
        service.get(macroUrl(name), { output_mode: 'json' }, function (err, resp) {
            if (err) { return; }
            try {
                var def = resp.data.entry[0].content.definition || '';
                $('#' + FIELD[name]).val(def);
            } catch (e) { /* macro may not exist yet */ }
        });
    });

    function saveMacro(name) {
        var def = $.trim($('#' + FIELD[name]).val());
        return $.Deferred(function (d) {
            if (!def) { return d.resolve({ name: name, skipped: true }); }
            service.post(macroUrl(name), { definition: def }, function (err) {
                if (err) { d.reject({ name: name, err: err }); }
                else { d.resolve({ name: name }); }
            });
        }).promise();
    }

    function markConfigured() {
        // Flip app is_configured so the setup banner goes away.
        return $.Deferred(function (d) {
            service.post('apps/local/' + APP, { configured: 1 }, function () { d.resolve(); });
        }).promise();
    }

    $(document).on('click', '#unifi_setup_save', function () {
        setStatus('Saving…', 'busy');
        $.when.apply($, MACROS.map(saveMacro)).done(function () {
            markConfigured().always(function () {
                setStatus('Saved. Macros updated — run the two lookup-generating searches to refresh enrichment.', 'ok');
            });
        }).fail(function (info) {
            var who = (info && info.name) ? (' (' + info.name + ')') : '';
            setStatus('Save failed' + who + '. You need write access to the app. You can also edit the macros under Settings → Advanced search.', 'err');
        });
    });
});
