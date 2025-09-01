---
layout: default
title: Juan Torres
---

<p style="margin-top:40px; text-align:center;">Juan Torres</p>
<div class="intro">
  <h1>Juan Torres</h1>
  <p>Certified Meat Cutter @ Meijer</p>
  <p>Logistics & Supply Chain Management</p>
  <p>
    <a href="#highlights">Highlights</a> &middot;
    <a href="#about">About</a> &middot;
    <a href="#contact">Contact</a>
  </p>
</div>

<hr>

<div id="highlights">
  <h2>Highlights</h2>
  {% for highlight in site.data.highlights %}
    <div class="project-card">
      <h3>{{ highlight.title }}</h3>
      <p>{{ highlight.description }}</p>
      {% if highlight.link %}
        <p><a href="{{ highlight.link }}" target="_blank">Learn More</a></p>
      {% endif %}
    </div>
  {% endfor %}
</div>

<hr>

<div id="about">
  <h2>About</h2>
  <p>
    Currently pursuing a bachelor's degree in Logistics management at Central Michigan University, with an associate's degree in General Studies from Baker College. As a Certified Meat Cutter at Meijer, I focus on precision cutting, maintaining safety protocols, and ensuring compliance with food safety regulations. My core competencies include meat processing, customer service, and inventory monitoring.<br><br>
    I’m passionate about operational efficiency and fostering positive customer experiences. My recent contributions at Meijer include supporting inventory accuracy with management systems and maintaining high standards in food safety compliance. I aim to leverage my diverse skills in supply chain management for organizational success and professional growth.
  </p>
</div>

<hr>

<div id="contact">
  <h2>Contact</h2>
  <p>
    <a href="mailto:juan.torres@email.com">Email</a> &middot;
    <a href="https://www.linkedin.com/in/juan-torres-0ab3471bb">LinkedIn</a>
  </p>
</div>