---
layout: distill
title: "The Fault in Our Metrics: Revisiting Generative Model Evaluation with Chamfer Distance"
description: "NeurIPS 2026, Evaluations & Datasets Track"
date: 2026-10-29
permalink: /chamfer/

hero_include: hero/chamfer-pentagons.liquid
hero_tldr:
  - Existing evaluation metrics for image generation are either uninformative or unreliable.
  - We introduce a simple, principled replacement that is intuitive, fast and interpretable.
hero_links:
  - label: Paper
    url: /assets/pdf/chamfer-paper.pdf
    icon: "fas fa-file-pdf"
  - label: Poster
    url: /assets/pdf/chamfer-poster.pdf
    icon: "fas fa-image"

authors:
  - name: Chirag Vashist
    url: "https://serchirag.github.io/"
    affiliations:
      name: "<a href='https://sfuapex.com/'>APEX Lab</a>, SFU"
  - name: Vaibhav Santhosh
    url: "https://www.linkedin.com/in/vaibhav-santhosh-/"
    affiliations:
      name: "NITK Surathkal"
  - name: Tristan Engst
    url: "https://tristanengst.github.io/"
    affiliations:
      name: "<a href='https://sfuapex.com/'>APEX Lab</a>, SFU"
  - name: Yanshu Zhang
    url: "https://zvict.github.io/"
    affiliations:
      name: "<a href='https://sfuapex.com/'>APEX Lab</a>, SFU"
  - name: Ke Li
    url: "https://www.sfu.ca/~keli/"
    affiliations:
      name: "<a href='https://sfuapex.com/'>APEX Lab</a>, SFU &middot; Amii and CIFAR"
---

## Abstract

Evaluation metrics decide which image generative models are judged better, yet widely used metrics are either uninformative or unreliable. Generative performance should be evaluated across two separate axes: the realism of the generated samples, and their coverage of the real distribution. Most popular metrics, including FID and KID, report a single symmetric score that conflates these two axes, which makes diagnosing and comparing models hard. A second family of metrics addresses this limitation by reporting along the two axes separately. We call such metrics disentangled, and they include Precision/Recall and Density/Coverage. However, we show that existing disentangled metrics approximate empirical distributions with oversized volumes, which can cause them to admit off-manifold samples. This causes these metrics to respond unreliably to simple distributional changes and image distortions. We propose Chamfer distance, an intuitive disentangled metric that directly measures cross-set nearest-neighbor distances between real and generated samples. We show that the resulting one-sided distances provide interpretable signals for fidelity and diversity, respond reliably to simple distributional changes, while remaining computationally efficient.

Code and a full write-up are coming soon.

## Poster

Won the Best Student Poster award at [SFU CS Research Day 2026](https://events.sfu.ca/event/50323-cs-research-day-2026).

{% include figure.liquid loading="eager" zoomable=true path="assets/img/chamfer/poster.jpg" class="img-fluid rounded z-depth-1" alt="Poster for The Fault in Our Metrics" avoid_scaling=true %}

[Download the poster (PDF)]({{ '/assets/pdf/chamfer-poster.pdf' | relative_url }})
