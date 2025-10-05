---
layout: default
title: Blog
---

<h1>Blog</h1>

<p>Welcome to my blog! I post regularly on Substack about finance, school, work, and more.</p>

<!-- Substack Link -->
<p>
  <a class="button" href="https://juantorresis.substack.com" target="_blank">Visit My Substack Blog</a>
</p>

<!-- Substack Signup Form -->
<div>
  <iframe src="https://juantorresis.substack.com/embed" width="480" height="320" style="border:1px solid #EEE; background:#FFF;" frameborder="0" scrolling="no"></iframe>
</div>

<!-- Substack RSS Feed Integration -->
<h2>Recent Posts</h2>
<ul id="substack-posts"></ul>
<script>
const RSS_URL = 'https://juantorresis.substack.com/feed';
fetch('https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(RSS_URL))
  .then(response => response.json())
  .then(data => {
    const posts = data.items.slice(0,5); // Show 5 recent posts
    const list = document.getElementById('substack-posts');
    posts.forEach(post => {
      const li = document.createElement('li');
      li.innerHTML = `<a href="${post.link}" target="_blank">${post.title}</a> <span class="date">${new Date(post.pubDate).toLocaleDateString()}</span>`;
      list.appendChild(li);
    });
  });
</script>
