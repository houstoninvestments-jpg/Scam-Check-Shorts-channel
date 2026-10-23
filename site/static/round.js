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
  function share() { return "Scam #" + pad3(round.number) + " · I caught " + caught + " of " + round.items.length; }

  function show() {
    app.innerHTML = "";
    var item = round.items[i];
    app.appendChild(el("p", "small", "Message " + (i + 1) + " of " + round.items.length));
    app.appendChild(el("p", "sender", "From: " + item.sender));
    app.appendChild(el("div", "bubble", item.body));
    var row = el("div", "row");
    var real = el("button", "btn alt", "Real");
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
    var next = el("button", "btn", i + 1 < round.items.length ? "Next message" : "See my score");
    next.onclick = function () { i++; i < round.items.length ? show() : done(); };
    app.appendChild(next);
  }

  function done() {
    app.innerHTML = "";
    app.appendChild(el("h2", null, "You caught " + caught + " of " + round.items.length));
    var line = el("div", "card", share());
    line.style.fontWeight = "700";
    app.appendChild(line);
    var btn = el("button", "btn", "Share my result");
    btn.onclick = function () {
      var text = share() + "\n" + location.origin + location.pathname;
      if (navigator.share) navigator.share({ text: text }).catch(function () {});
      else if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { btn.textContent = "Copied. Paste it anywhere."; });
    };
    app.appendChild(btn);
    var again = el("a", "btn alt", "Get tomorrow's round by email");
    again.href = root + "#signup";
    app.appendChild(again);
    try { localStorage.setItem("round-" + round.date, String(caught)); } catch (e) {}
    if (window.SON_onRoundDone) window.SON_onRoundDone(round, caught);
  }

  fetch(root + file).then(function (r) { if (!r.ok) throw new Error(); return r.json(); }).then(function (r) {
    round = r;
    document.getElementById("round-title").textContent = "Round for Scam #" + pad3(r.number);
    show();
  }).catch(function () {
    app.innerHTML = "";
    app.appendChild(el("p", null, "No round today yet. Check back after the next video."));
  });
})();
