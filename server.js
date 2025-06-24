var express = require("express");
var app = express();

var formidable = require("express-formidable");
app.use(formidable());

var mongodb = require("mongodb");
var mongoClient = mongodb.MongoClient;
var ObjectId = mongodb.ObjectId;

var httpObj = require("http");
var http = httpObj.createServer(app);

var bcrypt = require("bcrypt");
var fileSystem = require("fs");

var session = require("express-session");
app.use(session({
    secret: 'secret key',
    resave: false,
    saveUninitialized: false
}));

app.use("/public/css", express.static(__dirname + "/public/css"));
app.use("/public/js", express.static(__dirname + "/public/js"));
app.use("/public/img", express.static(__dirname + "/public/img"));
app.use("/public/font-awesome-4.7.0", express.static(__dirname + "/public/font-awesome-4.7.0"));
app.use("/public/fonts", express.static(__dirname + "/public/fonts"));

app.set("view engine", "ejs");
var mainURL = process.env.MAIN_URL || "http://localhost:3000";
var database = null;

app.use(function (request, result, next) {
    request.mainURL = process.env.MAIN_URL || (request.protocol + "://" + request.get("host"));
    request.isLogin = (typeof request.session.user !== "undefined");
    request.user = request.session.user;
    next();
});

function recursiveGetFile (files, _id) {
    var singleFile = null;
    for (var a = 0; a < files.length; a++) {
        const file = files[a];
        if (file.type != "folder") {
            if (file._id == _id) {
                return file;
            }
        }
        if (file.type == "folder" && file.files.length > 0) {
            singleFile = recursiveGetFile(file.files, _id);
            if (singleFile != null) {
                return singleFile;
            }
        }
    }
}

function getUpdatedArray (arr, _id, uploadedObj) {
    for (var a = 0; a < arr.length; a++) {
        if (arr[a].type == "folder") {
            if (arr[a]._id == _id) {
                arr[a].files.push(uploadedObj);
                arr[a]._id = ObjectId(arr[a]._id);
            }
            if (arr[a].files.length > 0) {
                arr[a]._id = ObjectId(arr[a]._id);
                getUpdatedArray(arr[a].files, _id, uploadedObj);
            }
        }
    }
    return arr;
}

function removeFileReturnUpdated(arr, _id) {
    for (var a = 0; a < arr.length; a++) {
        if (arr[a].type != "folder" && arr[a]._id == _id) {
            try {
                fileSystem.unlinkSync(arr[a].filePath);
            } catch (exp) {}
            arr.splice(a, 1);
            break;
        }
        if (arr[a].type == "folder" && arr[a].files.length > 0) {
            arr[a]._id = ObjectId(arr[a]._id);
            removeFileReturnUpdated(arr[a].files, _id);
        }
    }
    return arr;
}

function recursiveSearch (files, query) {
    var singleFile = null;
    for (var a = 0; a < files.length; a++) {
        const file = files[a];
        if (file.type == "folder") {
            if (file.folderName.toLowerCase().search(query.toLowerCase()) > -1) {
                return file;
            }
            if (file.files.length > 0) {
                singleFile = recursiveSearch(file.files, query);
                if (singleFile != null) {
                    if (singleFile.type != "folder") {
                        singleFile.parent = file;
                    }
                    return singleFile;
                }
            }
        } else {
            if (file.name.toLowerCase().search(query.toLowerCase()) > -1) {
                return file;
            }
        }
    }
}

function recursiveSearchShared (files, query) {
    var singleFile = null;
    for (var a = 0; a < files.length; a++) {
        var file = (typeof files[a].file === "undefined") ? files[a] : files[a].file;
        if (file.type == "folder") {
            if (file.folderName.toLowerCase().search(query.toLowerCase()) > -1) {
                return file;
            }
            if (file.files.length > 0) {
                singleFile = recursiveSearchShared(file.files, query);
                if (singleFile != null) {
                    if (singleFile.type != "folder") {
                        singleFile.parent = file;
                    }
                    return singleFile;
                }
            }
        } else {
            if (file.name.toLowerCase().search(query.toLowerCase()) > -1) {
                return file;
            }
        }
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

http.listen(3000, function () {
    console.log("Server started at " + mainURL);
    mongoClient.connect("mongodb+srv://Mayank:Mayank@cluster0.08rw4nt.mongodb.net/file_transfer?retryWrites=true&w=majority", {
        useUnifiedTopology: true
    }, function (error, client) {
        if (error) {
            console.error("MongoDB connection error:", error);
            return;
        }
        if (!client) {
            console.error("MongoDB client is undefined");
            return;
        }
        database = client.db("file_transfer");
        console.log("Database connected.");

        app.get("/Search", async function (request, result) {
            const search = request.query.search;
            if (request.session.user) {
                var user = await database.collection("users").findOne({
                    "_id": ObjectId(request.session.user._id)
                });
                var fileUploaded = await recursiveSearch(user.uploaded, search);
                var fileShared = await recursiveSearchShared(user.sharedWithMe, search);
                if (fileUploaded == null && fileShared == null) {
                    request.status = "error";
                    request.message = "File/folder '" + search + "' is neither uploaded nor shared with you.";
                    result.render("Search", {
                        "request": request
                    });
                    return false;
                }
                var file = (fileUploaded == null) ? fileShared : fileUploaded;
                file.isShared = (fileUploaded == null);
                result.render("Search", {
                    "request": request,
                    "file": file
                });
                return false;
            }
            result.redirect("/Login");
        });

        app.get("/Blog", async function (request, result) {
            result.render("Blog", {
                request: request
            });
        });

        app.get("/SharedWithMe/:_id?", async function (request, result) {
            result.render("SharedWithMe", {
                "request": request
            });
        });

        app.post("/DeleteLink", async function (request, result) {
            const _id = request.fields._id;
            if (request.session.user) {
                var link = await database.collection("public_links").findOne({
                    $and: [{
                        "uploadedBy._id": ObjectId(request.session.user._id)
                    }, {
                        "_id": ObjectId(_id)
                    }]
                });
                if (link == null) {
                    request.session.status = "error";
                    request.session.message = "Link does not exists.";
                    const backURL = request.header("Referer") || "/";
                    result.redirect(backURL);
                    return false;
                }
                await database.collection("public_links").deleteOne({
                    $and: [{
                        "uploadedBy._id": ObjectId(request.session.user._id)
                    }, {
                        "_id": ObjectId(_id)
                    }]
                });
                request.session.status = "success";
                request.session.message = "Link has been deleted.";
                const backURL = request.header("Referer") || "/";
                result.redirect(backURL);
                return false;
            }
            result.redirect("/Login");
        });

        app.get("/MySharedLinks", async function (request, result) {
            if (request.session.user) {
                var links = await database.collection("public_links").find({
                    "uploadedBy._id": ObjectId(request.session.user._id)
                }).toArray();
                result.render("MySharedLinks", {
                    "request": request,
                    "links": links
                });
                return false;
            }
            result.redirect("/Login");
        });

        app.get("/SharedViaLink/:hash", async function (request, result) {
            const hash = request.params.hash;
            var link = await database.collection("public_links").findOne({
                "hash": hash
            });
            if (link == null) {
                request.session.status = "error";
                request.session.message = "Link expired.";
                result.render("SharedViaLink", {
                    "request": request
                });
                return false;
            }
            result.render("SharedViaLink", {
                "request": request,
                "link": link
            });
        });

        app.post("/ShareViaLink", async function (request, result) {
            const _id = request.fields._id;
            if (request.session.user) {
                var user = await database.collection("users").findOne({
                    "_id": ObjectId(request.session.user._id)
                });
                var file = await recursiveGetFile(user.uploaded, _id);
                if (file == null) {
                    request.session.status = "error";
                    request.session.message = "File does not exists";
                    const backURL = request.header("Referer") || "/";
                    result.redirect(backURL);
                    return false;
                }
                bcrypt.hash(file.name, 10, async function (error, hash) {
                    hash = hash.substring(10, 20);
                    const link = mainURL + "/SharedViaLink/" + hash;
                    await database.collection("public_links").insertOne({
                        "hash": hash,
                        "file": file,
                        "uploadedBy": {
                            "_id": user._id,
                            "name": user.name,
                            "email": user.email
                        },
                        "createdAt": new Date().getTime()
                    });
                    request.session.status = "success";
                    request.session.message = "Share link: " + link;
                    const backURL = request.header("Referer") || "/";
                    result.redirect(backURL);
                });
                return false;
            }
            result.redirect("/Login");
        });

        app.post("/DeleteFile", async function (request, result) {
            const _id = request.fields._id;
            if (request.session.user) {
                var user = await database.collection("users").findOne({
                    "_id": ObjectId(request.session.user._id)
                });
                var updatedArray = await removeFileReturnUpdated(user.uploaded, _id);
                for (var a = 0; a < updatedArray.length; a++) {
                    updatedArray[a]._id = ObjectId(updatedArray[a]._id);
                }
                await database.collection("users").updateOne({
                    "_id": ObjectId(request.session.user._id)
                }, {
                    $set: {
                        "uploaded": updatedArray
                    }
                });
                const backURL = request.header('Referer') || '/';
                result.redirect(backURL);
                return false;
            }
            result.redirect("/Login");
        });

        app.post("/DownloadFile", async function (request, result) {
            const _id = request.fields._id;
            var link = await database.collection("public_links").findOne({
                "file._id": ObjectId(_id)
            });
            if (link != null) {
                fileSystem.readFile(link.file.filePath, function (error, data) {
                    result.json({
                        "status": "success",
                        "message": "Data has been fetched.",
                        "arrayBuffer": data,
                        "fileType": link.file.type,
                        "fileName": link.file.name
                    });
                });
                return false;
            }
            if (request.session.user) {
                var user = await database.collection("users").findOne({
                    "_id": ObjectId(request.session.user._id)
                });
                var fileUploaded = await recursiveGetFile(user.uploaded, _id);
                if (fileUploaded == null) {
                    result.json({
                        "status": "error",
                        "message": "File is neither uploaded nor shared with you."
                    });
                    return false;
                }
                var file = fileUploaded;
                fileSystem.readFile(file.filePath, function (error, data) {
                    result.json({
                        "status": "success",
                        "message": "Data has been fetched.",
                        "arrayBuffer": data,
                        "fileType": file.type,
                        "fileName": file.name
                    });
                });
                return false;
            }
            result.json({
                "status": "error",
                "message": "Please login to perform this action."
            });
            return false;
        });

        app.get("/MyUploads", async function (request, result) {
            if (request.session.user) {
                var user = await database.collection("users").findOne({
                    "_id": ObjectId(request.session.user._id)
                });
                var uploaded = user.uploaded;
                result.render("MyUploads", {
                    "request": request,
                    "uploaded": uploaded
                });
                return false;
            }
            result.redirect("/Login");
        });

        app.post("/UploadFile", async function (request, result) {
            if (request.session.user) {
                var user = await database.collection("users").findOne({
                    "_id": ObjectId(request.session.user._id)
                });
                if (request.files.file.size > 0) {
                    const _id = request.fields._id;
                    var uploadedObj = {
                        "_id": ObjectId(),
                        "size": request.files.file.size,
                        "name": request.files.file.name,
                        "type": request.files.file.type,
                        "filePath": "",
                        "createdAt": new Date().getTime()
                    };
                    var filePath = "public/uploads/" + user.email + "/" + new Date().getTime() + "-" + request.files.file.name;
                    uploadedObj.filePath = filePath;
                    if (!fileSystem.existsSync("public/uploads/" + user.email)){
                        fileSystem.mkdirSync("public/uploads/" + user.email);
                    }
                    fileSystem.readFile(request.files.file.path, function (err, data) {
                        if (err) throw err;
                        fileSystem.writeFile(filePath, data, async function (err) {
                            if (err) throw err;
                            await database.collection("users").updateOne({
                                "_id": ObjectId(request.session.user._id)
                            }, {
                                $push: {
                                    "uploaded": uploadedObj
                                }
                            });
                            request.session.status = "success";
                            request.session.message = "Image has been uploaded. Try our premium version for image compression.";
                            result.redirect("/MyUploads/" + _id);
                        });
                        fileSystem.unlink(request.files.file.path, function (err) {
                            if (err) throw err;
                        });
                    });
                } else {
                    request.status = "error";
                    request.message = "Please select valid image.";
                    result.render("MyUploads", {
                        "request": request
                    });
                }
                return false;
            }
            result.redirect("/Login");
        });

        app.get("/Logout", function (request, result) {
            request.session.destroy();
            result.redirect("/");
        });

        app.get("/Login", function (request, result) {
            result.render("Login", {
                "request": request
            });
        });

        app.post("/Login", async function (request, result) {
            var email = request.fields.email;
            var password = request.fields.password;
            var user = await database.collection("users").findOne({
                "email": email
            });
            if (user == null) {
                request.status = "error";
                request.message = "Email does not exist.";
                result.render("Login", {
                    "request": request
                });
                return false;
            }
            bcrypt.compare(password, user.password, function (error, isVerify) {
                if (isVerify) {
                    request.session.user = user;
                    result.redirect("/");
                    return false;
                }
                request.status = "error";
                request.message = "Password is not correct.";
                result.render("Login", {
                    "request": request
                });
            });
        });

        app.post("/Register", async function (request, result) {
            var name = request.fields.name;
            var email = request.fields.email;
            var password = request.fields.password;
            var reset_token = "";
            var isVerified = true;
            var verification_token = new Date().getTime();
            var user = await database.collection("users").findOne({
                "email": email
            });
            if (user == null) {
                bcrypt.hash(password, 10, async function (error, hash) {
                    await database.collection("users").insertOne({
                        "name": name,
                        "email": email,
                        "password": hash,
                        "reset_token": reset_token,
                        "uploaded": [],
                        "sharedWithMe": [],
                        "isVerified": isVerified,
                        "verification_token": verification_token
                    }, async function (error, data) {
                        request.status = "success";
                        request.message = "Signed up successfully. You can login now.";
                        result.render("Register", {
                            "request": request
                        });
                    });
                });
            } else {
                request.status = "error";
                request.message = "Email already exist.";
                result.render("Register", {
                    "request": request
                });
            }
        });

        app.get("/Register", function (request, result) {
            result.render("Register", {
                "request": request
            });
        });

        app.get("/", function (request, result) {
            result.render("index", {
                "request": request
            });
        });
    });
});