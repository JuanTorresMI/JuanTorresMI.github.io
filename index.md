---
layout: default
title: Juan Torres
---

<div class="intro">
  <h1>Juan Torres</h1>
  <p>Data Scientist & Developer</p>
  <p>
    <a href="#projects">Projects</a> &middot;
    <a href="#about">About</a> &middot;
    <a href="#contact">Contact</a>
  </p>
</div>

<hr>

<div id="projects">
  <h2>Projects</h2>
  {% for project in site.data.projects %}
    <div class="project-card">
      <h3>{{ project.title }}</h3>
      <p>{{ project.description }}</p>
      {% if project.link %}
        <p><a href="{{ project.link }}" target="_blank">View Project</a></p>
      {% endif %}
    </div>
  {% endfor %}
</div>

<hr>

<div id="about">
  <h2>About</h2>
  <p>
    Passionate about data, technology, and minimal design.  
    Experienced in Python, ML, and web development.  
    <br>
    Always learning, always building.
  </p>
</div>

<hr>

<div id="contact">
  <h2>Contact</h2>
  <p>
    <a href="mailto:juan.torres@email.com">Email</a> &middot;
    <a href="https://www.linkedin.com/in/juan-torres/">LinkedIn</a>
  </p>
</div>
