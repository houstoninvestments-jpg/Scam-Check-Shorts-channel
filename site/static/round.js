// Daily round: three messages, real or scam. Works offline from the JSON the site builds each day.
(function () {
  "use strict";
  var app = document.getElementById("round");
  var root = app.getAttribute("data-root");
  var params = new URLSearchParams(location.search);
  var file = params.get("d") ? "rounds/" + params.get("d").replace(/[^0-9-]/g, "") + ".json" : "rounds/latest.json";
  var round, i = 0, caught = 0;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function pad3(n) { return String(n).padStart(3, "0"); }
  // Same phone screen as the home page and the videos.
  function phone(item) {
    var stage = el("div", "stage");
    stage.style.paddingTop = "0";
    var ph = el("div", "phone");
    var sc = el("div", "screen");
    var bar = el("div", "bar"); bar.appendChild(el("span", null, "9:41")); bar.appendChild(el("span", null, "\u25AE\u25AE\u25AE"));
    var who = el("div", "who"); var av = el("i", null, /^[+\d(]/.test(item.sender) ? "?" : item.sender.charAt(0).toUpperCase()); who.appendChild(av); who.appendChild(el("span", null, item.sender));
    sc.appendChild(bar); sc.appendChild(who); sc.appendChild(el("div", "when", "Text Message \u00b7 Today 9:41"));
    var b = el("div", "bubble", item.body); b.setAttribute("data-quote", "");
    sc.appendChild(b); ph.appendChild(sc); stage.appendChild(ph);
    return stage;
  }
  function share() { return "Scam #" + pad3(round.number) + " · I caught " + caught + " of " + round.items.length; }

  function show() {
    app.innerHTML = "";
    var item = round.items[i];
    app.appendChild(el("p", "small", "Message " + (i + 1) + " of " + round.items.length));
    app.appendChild(phone(item));
    var row = el("div", "row");
    var real = el("button", "btn", "Real");
    var scam = el("button", "btn", "Scam");
    real.onclick = function () { answer("real"); };
    scam.onclick = function () { answer("scam"); };
    row.appendChild(real); row.appendChild(scam);
    app.appendChild(row);
  }

  function answer(pick) {
    var item = round.items[i];
    var right = pick === item.answer;
    if (right) caught++;
    app.querySelector(".row").remove();
    var res = el("div", "card");
    res.appendChild(el("p", null, right ? "You got it." : "Not this time."));
    var tag = el("span", item.answer === "scam" ? "verdict" : "real", item.answer === "scam" ? "SCAM" : "REAL");
    res.appendChild(tag);
    if (item.flags) {
      var ul = el("ul", "flags");
      item.flags.forEach(function (f) { ul.appendChild(el("li", null, f)); });
      res.appendChild(ul);
    }
    res.appendChild(el("p", null, item.why));
    if (item.page) { var a = el("a", null, "See the full breakdown"); a.href = item.page; res.appendChild(a); }
    app.appendChild(res);
    var next = el("button", "btn light", i + 1 < round.items.length ? "Next message" : "See my score");
    next.onclick = function () { i++; i < round.items.length ? show() : done(); };
    app.appendChild(next);
  }

  function done() {
    app.innerHTML = "";
    app.appendChild(el("h2", null, "You caught " + caught + " of " + round.items.length));
    var line = el("div", "card", share());
    line.style.fontWeight = "700";
    app.appendChild(line);
    var btn = el("button", "btn main", "Share my result");
    btn.onclick = function () {
      // Link to this exact day's round; the page's preview card is the site-wide default.
      var text = share() + "\n" + location.origin + location.pathname + "?d=" + round.date + (round.hashtags ? "\n" + round.hashtags.join(" ") : "");
      if (navigator.share) navigator.share({ text: text }).catch(function () {});
      else if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { btn.textContent = "Copied. Paste it anywhere."; });
    };
    app.appendChild(btn);
    var signupOn = window.SON && SON.supabaseUrl && SON.supabaseKey;
    var again = el("a", "btn", signupOn ? "Get tomorrow's round by email" : "See past scams");
    again.href = root + (signupOn ? "#signup" : "scams/");
    app.appendChild(again);
    try { localStorage.setItem("round-" + round.date, String(caught)); } catch (e) {}
    if (window.SON_onRoundDone) window.SON_onRoundDone(round, caught);
  }

  fetch(root + file).then(function (r) { if (!r.ok) throw new Error(); return r.json(); }).then(function (r) {
    round = r;
    document.getElementById("round-title").textContent = "Round for Scam No. " + pad3(r.number);
    show();
  }).catch(function () {
    app.innerHTML = "";
    app.appendChild(el("p", null, "No round today yet. Check back after the next video."));
  });
})();
