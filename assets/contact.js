// Contact form: sends messages through Formspree without leaving the page.
(function () {
  'use strict';
  var form = document.getElementById('contact-form');
  var section = document.getElementById('contact');
  if (!form || !section) return;
  var endpoint = form.getAttribute('data-endpoint');
  if (!endpoint) return; // stays hidden until a Formspree address is set
  section.hidden = false;

  var status = form.querySelector('.form-status');
  var button = form.querySelector('button[type=submit]');
  var labels = { customer: 'Customer', maker: 'Maker', cafe: 'Café', other: 'Other' };

  // "Get in touch" / "Host a cabinet" buttons pre-select who the message is from
  document.querySelectorAll('a[data-about]').forEach(function (a) {
    a.addEventListener('click', function () { form.about.value = a.getAttribute('data-about'); });
  });

  function say(text, kind) {
    status.textContent = text;
    status.className = 'form-status' + (kind ? ' ' + kind : '');
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (form._gotcha.value) return; // a bot filled in the hidden field
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    button.disabled = true;
    say('Sending…');
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name.value,
        email: form.email.value,
        about: labels[form.about.value] || form.about.value,
        message: form.message.value,
        _subject: 'Craft Hereford website: message from ' + form.name.value,
        _gotcha: form._gotcha.value
      })
    }).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      form.reset();
      say("Thank you! Your message has been sent and we'll be in touch soon.", 'ok');
    }).catch(function () {
      say('Sorry, your message didn’t send. Please try again, or message us on Instagram or Facebook.', 'error');
    }).then(function () {
      button.disabled = false;
    });
  });
})();
