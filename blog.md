---
layout: default
title: Blog
---

<h1 style="font-size:1.8rem; font-weight:300; margin-bottom:0.4rem;">Blog</h1>
<p>I write on Substack about finance, school, work, and more.</p>

<p>
  <a class="button" href="https://juantorresis.substack.com" target="_blank">Visit My Substack</a>
</p>

<div style="margin: 1.5rem 0;">
  <iframe src="https://juantorresis.substack.com/embed" width="100%" height="280" style="border:1px solid #eee; background:#fff; border-radius:10px;" frameborder="0" scrolling="no"></iframe>
</div>

<hr>

<h2>Recent Posts</h2>
<ul id="substack-posts" style="padding-left:0;"></ul>

<script>
fetch('https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent('https://juantorresis.substack.com/feed'))
  .then(r => r.json())
  .then(data => {
    const list = document.getElementById('substack-posts');
    (data.items || []).slice(0, 5).forEach(post => {
      const li = document.createElement('li');
      const date = new Date(post.pubDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
      li.innerHTML = `<a href="${post.link}" target="_blank" rel="noopener">${post.title}</a> <span class="date">&mdash; ${date}</span>`;
      list.appendChild(li);
    });
  })
  .catch(() => {});
</script>
