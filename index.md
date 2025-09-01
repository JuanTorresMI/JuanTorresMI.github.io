---
layout: default
title: Juan Torres
---

<div class="intro">
  <img src="/assets/img/juan-torres.jpg" alt="Juan Torres" class="profile-photo">
  <h1>Juan Torres</h1>
  <p>Certified Meat Cutter @ Meijer</p>
  <p>Logistics & Supply Chain Management</p>
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
    Hi, I’m Juan Torres—a Certified Meat Cutter at Meijer with a strong passion for logistics and supply chain management. My career in the food industry has given me hands-on experience in product handling, inventory control, and process optimization.<br><br>
    I’m dedicated to efficiency, teamwork, and long-term growth. I believe that smart logistics and supply chain strategies are key to delivering quality products and customer satisfaction.
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
