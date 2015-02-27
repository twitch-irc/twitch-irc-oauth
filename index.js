/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2015 Schmoopiie
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NON INFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

var express  = require('express');
var method   = require('method-override');
var parser   = require('body-parser');
var passport = require('passport');
var session  = require('express-session');
var strategy = require('passport-twitch').Strategy;
var app      = express();

module.exports = function(client, db) {
    var options = {};

    try { options = client.getOptions().oauth || {}; }
    catch(err) {
        console.log(err);
    }

    var assets       = options.assets || __dirname + '/oauth/public';
    var hostname     = options.hostname || '127.0.0.1';
    var port         = options.port || 51230;
    var clientID     = options.clientID || '';
    var clientSecret = options.clientSecret || '';
    var redirect     = options.redirect || '';
    var scopes       = options.scopes || 'user_read';
    var views        = options.views || __dirname + '/oauth/views';

    if (clientID.trim() !== '' && clientSecret.trim() !== '' && scopes.trim() !== '') {
        var callback = 'http://' + hostname + ':' + port + '/auth/twitch/callback';

        if (scopes.indexOf('user_read') < 0) { scopes = 'user_read,' + scopes; }

        passport.serializeUser(function (user, done) {
            done(null, user);
        });

        passport.deserializeUser(function (obj, done) {
            done(null, obj);
        });

        passport.use(new strategy({
                clientID: clientID,
                clientSecret: clientSecret,
                callbackURL: callback,
                scope: scopes
            },
            function (accessToken, refreshToken, profile, done) {
                process.nextTick(function () {
                    if (db) {
                        db.where('tokens', {channel: profile.username.toLowerCase()}).then(function (result) {
                            if (result.items.length <= 0) {
                                db.insert('tokens', {channel: profile.username.toLowerCase(), token: accessToken, scopes: scopes});
                            } else {
                                db.update('tokens', result.items[0].cid, {token: accessToken, scopes: scopes});
                            }
                        });
                    }
                    client.emit('oauth', profile.username, accessToken, scopes);

                    profile.token = accessToken;
                    profile.scopes = scopes;
                    return done(null, profile);
                });
            }
        ));

        app.use(express.static(assets));

        app.use(parser.urlencoded({
            extended: true
        }));
        app.use(parser.json());
        app.use(method());

        app.set('views', views);
        app.engine('.html', require('ejs').renderFile);
        app.set('view engine', 'html');
        app.set('view options', { layout: false });
        app.use(express.Router());
        app.use(session({
            secret: 'keyboard cat',
            resave: false,
            saveUninitialized: true
        }));

        app.use(passport.initialize());
        app.use(passport.session());

        app.get('/', passport.authenticate('twitch', { scope: scopes.split(',') }), function (req, res) { });
        app.get('/failed', function (req, res) { res.render('failed.html'); });
        app.get('/success', function (req, res) { res.render('success.html'); });

        app.get('/auth/twitch/callback', function(req, res, next) {
            var failURL = '/failed';
            if (redirect !== '') {
                var firstSep = (decodeURIComponent(redirect).indexOf('?')== -1 ? '?' : '&');
                failURL = decodeURIComponent(redirect) + firstSep + 'request=failed';
            }

            passport.authenticate('twitch', function(err, user) {
                if (err) { return next(err); }
                if (!user) { return res.redirect(failURL); }

                req.logIn(user, function(err) {
                    if (err) { return next(err); }

                    if (redirect !== '') {
                        var firstSep = (decodeURIComponent(redirect).indexOf('?')== -1 ? '?' : '&');
                        res.redirect(decodeURIComponent(redirect) + firstSep + 'request=success&username=' + req.user.username + '&token=' + req.user.token + '&email=' + req.user.email + '&scopes=' + req.user.scopes);
                    } else {
                        res.redirect('/success');
                    }
                    req.session.destroy(function(err) {});
                });
            })(req, res, next);
        });

        app.listen(port, '0.0.0.0');
    }
};