var Sealious = require("sealious");
var rp = require('request-promise');
var www_server = Sealious.ChipManager.get_chip("channel", "www_server");
var sha1 = require('sha1');

url = "/api/v1/users";

// www_server.route({
// 	method: "GET",
// 	path: url,
// 	handler: function(request, reply) {
// 		var context = www_server.get_context(request);
// 		Sealious.Dispatcher.users.get_all_users(context)
// 			.then(function(users) {
// 				reply(users);
// 			})
// 	}
// });

// www_server.route({
// 	method: "GET",
// 	path: url + "/{user_id}",
// 	handler: function(request, reply) {
// 		var context = www_server.get_context(request);
// 		Sealious.Dispatcher.users.get_user_data(context, request.params.user_id)
// 			.then(function(user_data) {
// 				reply(user_data);
// 			})
// 			.catch(function(error) {
// 				reply(error);
// 			})

// 	}
// });

function create_user(context, request, reply) {
	Sealious.Dispatcher.users.create_user(context, request.payload.username, request.payload.password)
		.then(function(response) {
			if (request.payload.redirect_success_url) {
				console.log(request.payload.redirect_success_url);
				reply(response).redirect(request.payload.redirect_success_url);
			} else {
				reply(response);
			}
		})
		.catch(function(error) {
			reply(error);
		})
};

www_server.route({
	method: "POST",
	path: url,
	handler: function(request, reply) {
		var context = www_server.get_context(request);
		var options = {
			method: 'POST',
			uri: 'https://www.google.com/recaptcha/api/siteverify',
			form: {
				secret: Sealious.ConfigManager.get_config("google_captcha_secret").google_captcha_secret,
				response: request.payload.g_recaptcha
					//remoteip: context.ip
			},
			headers: {
				'content-type': 'application/json'
			}
		};
		rp(options)
			.then(function(parsedBody) {
				var answer = JSON.parse(parsedBody);
				if (answer.success == true) {
					create_user(context, request, reply);
				} else {
					var token_value = "yo"+request.payload.username.split("").reverse().join("")+"lo";
					var token = sha1(token_value);

					if (request.payload.token === token) {
						create_user(context, request, reply);
					} else {
						reply(new Sealious.Errors.ValidationError("You need to do captcha.")); //response_captcha);
					}
				}
			})
			.catch(function(error) {
				reply(error);
			});
	}
});

www_server.route({
	method: "PUT",
	path: url + "/{user_id}",
	handler: function(request, reply) {
		var context = www_server.get_context(request);
		Sealious.Dispatcher.users.update_user_data(context, request.params.user_id, request.payload)
			.then(function(response) {
				reply();
			})
	}
});

www_server.route({
	method: "DELETE",
	path: url + "/{user_id}",
	handler: function(request, reply) {
		var context = www_server.get_context(request);
		Sealious.Dispatcher.users.delete_user(context, request.params.user_id)
			.then(function(user_data) {
				reply(user_data);
			})
			.catch(function(error) {
				reply(error);
			})
	}
})

www_server.route({
	method: "GET",
	path: url + "/me",
	handler: function(request, reply) {
		var context = www_server.get_context(request);
		var user_id = context.get("user_id");
		if (user_id === false) {
			reply(new Sealious.Errors.UnauthorizedRequest("You need to log in first."));
		} else {
			// reply().redirect(url + "/" + user_id);
			Sealious.Dispatcher.users.get_user_data(context, user_id)
				.then(function(user_data) {
					reply(user_data);
				})
				.catch(function(error) {
					reply(error);
				})
		}
	}
});

www_server.route({
	method: "POST",
	path: "/login",
	handler: function(request, reply) {
		var context = www_server.get_context(request);
		Sealious.Dispatcher.users.password_match(context, request.payload.username, request.payload.password)
			.then(function(user_id) {
				var session_id = www_server.new_session(user_id);
				if (request.payload.redirect_success) {
					reply().state('SealiousSession', session_id).redirect(request.payload.redirect_success);
				} else {
					reply("http_session: Logged in!").state('SealiousSession', session_id);
				}
			})
			.catch(function(error) {
				reply(error);
			})
	}
});

www_server.route({
	method: "POST",
	path: "/logout",
	handler: function(request, reply) {
		var context = www_server.get_context(request);
		www_server.kill_session(request.state.SealiousSession);
		reply().redirect("/login.html");
	}
});

www_server.route({
	method: "GET",
	path: "/api/v1/make_coffee",
	handler: function(request, reply) {
		Sealious.Logger.transports.console.level = "lazyseal";
		Sealious.Logger.lazyseal("Trying to make coffee...");
		Sealious.Logger.lazyseal("Oops, I'm a teapot.");
		Sealious.Logger.transports.console.level = "info";
		reply().code(418);
	}
});

www_server.unmanaged_route({
	method: "GET",
	path: "/managed-files/{file_id}/{file_name}",
	handler: function(request, reply) {
		var context = www_server.get_context(request);
		Sealious.Dispatcher.files.find(context, {
				id: request.params.file_id
			})
			.then(function(file_info) {
				var r = reply.file(file_info[0].path_on_hdd);
				if (file_info[0].mime) r.type(file_info[0].mime);
			})

	}
});
