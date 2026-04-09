---
layout: default
title: Juan Torres
---

<div class="intro">
  <h1>Juan Torres</h1>
  <p class="subtitle">Business Administration &amp; Logistics</p>
  <p class="summary">Junior at Central Michigan University. Experienced in operations, inventory management, and team leadership at Meijer.</p>
  <p class="intro-links">
    <a href="mailto:Torre10j@cmich.edu">Email</a> &middot;
    <a href="https://www.linkedin.com/in/juan-torres-0ab3471bb">LinkedIn</a> &middot;
    <a href="/resume/">Resume</a> &middot;
    <a href="/blog/">Blog</a>
  </p>
</div>

<hr>

<section id="about">
  <h2>About</h2>
  <p>I'm a Business Administration student at Central Michigan University concentrating in Logistics Management. I work as a Meat Cutter at Meijer, where I've developed strong skills in food safety compliance, inventory management, and team training. I'm interested in supply chain operations, operational analytics, and process improvement.</p>
</section>

<hr>

<section id="highlights">
  <h2>Highlights</h2>
  <ul>
    {% for item in site.data.highlights %}
    <li>
      <span class="highlight-title">{{ item.title }}</span>
      <span class="highlight-desc">{{ item.description }}</span>
    </li>
    {% endfor %}
  </ul>
</section>

<hr>

<section id="contact">
  <h2>Contact</h2>
  <p>
    <a href="mailto:Torre10j@cmich.edu" class="button">Email Me</a>
    <a href="/resume/" class="button button-outline">View Resume</a>
  </p>
</section>
