
module.exports = {

    checkNetwork: function(web3) {

        setTimeout(()=>{
            ver = web3.version.network

            web3.version.getNetwork((e,r)=>{
                if ( r != ver ) {
                    console.log("ERROR: Metamask version mismatch", r, "!=", ver)
                    console.log("Probably Metamask didn't notice ganache restart. Switch network, and back")
                }
            })

        }, 100)
    },

    //dump log string into <div id='logpanel'> (or to console log, if no such panel)
    log: function () {
        let argstr = Array.prototype.slice.call(arguments).join(" ");
        if (window && window.logpanel)
            {
                window.logpanel.innerHTML += "\n" + argstr + "<br>"
            }
        else console.log(argstr)
    },

    promisify: function (f) {
        return function () {
            let args = Array.prototype.slice.call(arguments)
            return new Promise((resolve, reject) => {
                args.push((e, r) => {
                    if (e) return reject(e)
                    else return resolve(r)
                })
                f.apply(null, args)
            })
        }
    },

    saveCookie: function (name, val) {
        document.cookie = name + '=' + val
    },

    getCookie: function (name, def) {
        let c = document.cookie.match("\\b" + name + "=([^;]*)")
        return c ? c[1] : def
    },

    httpreq: function (url, options) {
        return new Promise((resolve, reject) => {
            module.exports.asyncHttpReq(url, options, (e, r) => {
                if (e) return reject(e)
                return resolve(r)
            })
        })
    },

    asyncHttpReq: function (url, options, cb) {
        options = options || {}
        let headers = options.headers || {}

        let data
        if (options.json) {
            data = JSON.stringify(options.json)
            headers["Content-Type"] = "application/json"
        } else {
            data = options.data
        }

        let method = options.method || ( data ? "POST" : "GET")

        let xhttp = new XMLHttpRequest();
        for (let hv in headers) {
            console.log(hv)
            // xhttp.addRequestHeader(h, v)
        }
        xhttp.onreadystatechange = function () {
            if (this.readyState != 4)
                return
            if (this.status == 0)
                return cb({error: 0}, null)
            let stat = Math.trunc(this.status / 100)
            if (stat < 2)
                return  //100 continue?
            if (stat == 2) {
                return cb(null, {
                    status: this.status, statusText: this.statusText,
                    response: this.response,
                    json: options.json ? JSON.parse(this.resultText) : undefined,
                })
            }
            if (stat == 3) {
                //todo: redirect
                return cb({"redirect": this}, null)
            }
            //must be >=400
            cb(this, null)
        };
        xhttp.open(method, url, true);
        xhttp.send();
    },

    //from a given html <form> (or <div>), save all input members that are of type 'text'
    // fields are saved into a cookie with the given name.
    saveForm: function(form, cookieName) {
        let ret = Array.prototype.slice.call(form.getElementsByTagName('*'))
            .filter(a => a.type == 'text')
            .map(c => c.id + "=" + c.value)
            .join("~")
        console.log( "saving cookie", cookieName, '=', ret.split("~"))
        this.saveCookie(cookieName, ret)
    },

    //reload form from cookies.
    // the form and cookie must match those given to saveForm
    loadForm: function(form, cookieName) {
        let val = module.exports.getCookie(cookieName)
        if (!val) return
        console.log( "loading cookie:", val.split("~"))
        val.split("~").forEach(s => {
            let nameval = s.match(/\b([^=]+)=(.*)/);
            if (nameval) {
                let itemname = nameval[1];
                val = nameval[2]
                if (form.children[itemname])
                    form.children[itemname].value = val
                else
                    console.log("name not found for  " + name + "=" + val, 'in', val)
            } else
                console.log("invalid cookie value " + s)
        })
    }

}