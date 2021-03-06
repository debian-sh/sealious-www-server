var Sealious = require("sealious");
var sha1 = require("sha1");

var Promise = require("bluebird");

var http_channel = Sealious.ChipManager.get_chip("channel", "http");

var session_id_to_user_id = {};

var urldecode = require("querystring").decode;

var www_server = new Sealious.ChipTypes.Channel("www_server");

www_server.default_configuration = {
    port: 80
}

www_server.server = http_channel.new_server();
www_server.server.connection({port: www_server.configuration.port,  routes: { cors: true }})

www_server.start = function(){
    process.on('uncaughtException', function(err) {
        if(err.errno === 'EADDRINUSE')
            console.log("Port " + www_server.configuration.port + " is already taken - cannot start www-server.");
        else if(err.errno === 'EACCES')
            console.log("Unsufficient privileges to start listening on port " + www_server.configuration.port + ".");
        else 
            console.error(err);
        process.exit(1);
    });  
    www_server.server.start(function(err){
        Sealious.Logger.info('SERVER RUNNING: '+www_server.server.info.uri+"\n");
    })
}

www_server.get_context = function(request){
    var d = new Date();
    var timestamp = d.getTime();
    var ip = request.info.remoteAddress;
    var user_id = www_server.get_user_id(request.state.SealiousSession);
    return new Sealious.Context(timestamp, ip, user_id);
}

function process_sealious_response_element(element){
    var processed_element = {};
    for(var key in element){
        var value = element[key];
        if(value instanceof Sealious.File.Reference){
            if(value.filename===""){
                processed_element[key] = undefined;    
            }else{
                processed_element[key] = "/managed-files/" + value.id + "/" + value.filename;      
            }
        }else if(value instanceof Array){
            processed_element[key] = value;
        }else if(typeof value=="object"){
            processed_element[key] = process_sealious_response_element(value);
        }else{
            processed_element[key] = value;
        }
    }
    return processed_element;
}

function process_sealious_response(obj){
    if(obj instanceof Array){
        return obj.map(process_sealious_response_element);
    }else{
        return process_sealious_response_element(obj);
    }
}

function custom_reply_function(original_reply_function, request_details, obj, status_code){
    var client_ip = request_details._request_object.info.remoteAddress;
    var mime_type = request_details._request_object.mime;
    var request_description = "\t" + request_details.method + " " + request_details.path + "\n\t\t\tfrom: " + client_ip + ", mime: " + mime_type + "\n\t\t\tresult: ";
    var ret;
    if(obj==undefined){
        obj={};
    };
    if(obj.is_sealious_error || obj.is_error){
        var res = Sealious.Response.fromError(obj);
        Sealious.Logger.error(request_description+"failed - "+obj.status_message);
        ret = original_reply_function(res);
        ret.code(obj.http_code);
        console.log(obj.stack);
    }else if(obj instanceof Error){
        Sealious.Logger.error(request_description);
        Sealious.Logger.error(obj);
        console.log(obj.stack);
        var err = Sealious.Errors.Error("Internal server error")
        var res = Sealious.Response.fromError(err);
        ret = original_reply_function(res).code(err.http_code);
    }else{
        Sealious.Logger.info(request_description + "success!");
        var processed_obj = process_sealious_response(obj)
        ret = original_reply_function(processed_obj);
    }
    return ret;
}

function process_request(old_request){
    var context = www_server.get_context(old_request);
    if(old_request.mime=="multipart/form-data"){
        for(var i in old_request.payload){
            if(old_request.payload[i].readable){
                //this means this attribute is a file
                var filename = old_request.payload[i].hapi.filename;
                if(filename==""){
                    old_request.payload[i] = undefined;
                }else{
                    var data = old_request.payload[i]._data;
                    var mime_type = old_request.payload[i].hapi.headers["content-type"];
                    old_request.payload[i] = new Sealious.File(context, filename, data, null, mime_type);
                }
            }else if(old_request.payload[i] instanceof Array){
                for(var j in old_request.payload[i]){
                    if(old_request.payload[i][j].readable){
                        var filename = old_request.payload[i][j].hapi.filename;
                        var data = old_request.payload[i][j]._data;
                        var mime_type = old_request.payload[i][j].hapi.headers["content-type"];
                        old_request.payload[i][j] = new Sealious.File(context, filename, data, null, mime_type);                            
                    }
                }
            }
        }
    }else{
        //it is not multipart
        if(old_request.payload && old_request.payload.readable){
            //it is not multipart BUT it is a stream;
            var data_buffer = old_request.payload.read();
            var data = data_buffer === null? {} : urldecode(data_buffer.toString());
            //assuming the buffer is url_encoded. might be json, though?
            old_request.payload = data;
        }
    }
    return old_request;
}

www_server.route = function(){
    var original_handler = arguments[0].handler || arguments[0].config.handler;
    if(original_handler && typeof original_handler=="function"){
        var new_handler = function(request, reply){
            var request_details = {
                method: request.method.toUpperCase(),
                path: request.path,
                _request_object: request
            };
            var new_reply = custom_reply_function.bind(custom_reply_function, reply, request_details);
            var new_request = process_request(request);
            original_handler(new_request, new_reply);
        }
        if(arguments[0].handler) arguments[0].handler = new_handler; else arguments[0].config.handler = new_handler;
    }
    www_server.server.route.apply(this.server, arguments);
}

www_server.unmanaged_route = www_server.server.route.bind(www_server.server);


www_server.static_route = function(path, url) {        
    this.server.route({ 
        method: 'GET',
        path: url + '/{param*}',
        handler: {
            directory: {
                path: path
            }
        }
    });
}


function generate_session_id() {
    var seed = Math.random().toString();
    var session_id = sha1(seed);
    return session_id;
}

function new_session(user_id) {
    var session_id = generate_session_id();
    session_id_to_user_id[session_id] = user_id;
    return session_id;
}

function kill_session(session_id) {
    Sealious.Logger.info("Killing session: ", session_id);
    delete session_id_to_user_id[session_id];
}

function get_user_id(session_id) {
    if (session_id_to_user_id[session_id]==undefined) {
        return false;        
    }else{
        return session_id_to_user_id[session_id];
    }
}

www_server.generate_session_id = generate_session_id;
www_server.new_session = new_session;
www_server.kill_session = kill_session;
www_server.get_user_id = get_user_id;
