// Daily round email signup. Saves the address to the free database; nothing else is collected.
(function () {
  "use strict";
  var form = document.getElementById("signup-form");
  if (!form || !window.SON || !SON.supabaseUrl || !SON.supabaseKey) return;
  document.getElementById("signup").classList.remove("hidden");
  var msg = document.getElementById("signup-msg");
  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var email = form.email.value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg.textContent = "That email doesn't look right. Try again."; return; }
    msg.textContent = "Saving...";
    fetch(SON.supabaseUrl + "/rest/v1/round_signups", {
      method: "POST",
      headers: { apikey: SON.supabaseKey, "content-type": "application/json", prefer: "return=minimal" },
      body: JSON.stringify({ email: email, source: "link-page" })
    }).then(function (r) {
      if (r.ok || r.status === 409) { msg.textContent = "You're in. Watch for tomorrow's round."; form.reset(); }
      else msg.textContent = "Something went wrong. Please try again later.";
    }).catch(function () { msg.textContent = "Something went wrong. Please try again later."; });
  });
})();
