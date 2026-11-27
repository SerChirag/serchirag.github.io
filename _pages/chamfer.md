---
layout: distill
title: "The Fault in Our Metrics: Revisiting Generative Model Evaluation with Chamfer Distance"
description: "NeurIPS 2026, Evaluations & Datasets Track"
date: 2026-10-29
permalink: /chamfer/
# Citations: <d-cite key="..."></d-cite>, with keys from assets/bibliography/chamfer.bib (the paper's references.bib).
bibliography: chamfer.bib

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

# Contents in a sticky sidebar left of the text, built from the ## and ### headings.
toc: auto
toc_sidebar: true

# One width for every section, text included: 920px, or the window less a 32px
# margin on each side when that is narrower. 920px is a little above the
# narrowest the simulator gets before its steps wrap and the box grows taller
# (about 900px). Phones keep Distill's own layout.
_styles: |
  @media (min-width: 768px) {
    body d-title,
    body d-byline,
    body d-article,
    body d-appendix {
      grid-template-columns: [screen-start] minmax(0, 1fr) [page-start kicker-start kicker-end middle-start text-start] minmax(0, 920px) [text-end middle-end gutter-start gutter-end page-end] minmax(0, 1fr) [screen-end];
    }
  }
  /* Planning notes while the write-up is drafted; delete each one once its section is written. */
  .plan-note {
    margin: 0 0 1.75rem;
    padding: 0.6rem 0.9rem;
    border: 1px dashed var(--global-divider-color);
    border-radius: 6px;
    font-size: 0.9rem;
  }
  .plan-note::before {
    content: "Plan";
    display: block;
    margin-bottom: 0.25rem;
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  body d-article .plan-note,
  body d-article .plan-note::before,
  body d-article .plan-note p,
  body d-article .plan-note li {
    color: var(--global-text-color-light);
  }
  body d-article .plan-note ul {
    margin: 0;
    padding-left: 1.1rem;
  }

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

## Motivation

In the last decade, image generation models have improved significantly. Because judging a model requires thousands of its generated images, it is infeasible to check each generated image visually. AI researchers rely on automated evaluation metrics to help them decide which model is doing better.

These metrics play a crucial role: they decide which tradeoffs are made visible, which models are judged better and in which direction the field moves.

In this paper, we show that existing popular evaluation metrics are fundamentally broken: they are either unreliable or uninformative. To illustrate this point, consider a simple 2D example: two sets of pentagons. Let us see how existing metrics perform on this simple test.

{% include chamfer/pentagon-sim.liquid caption="A simple 2D test. Choose a metric to see how it compares the real and generated samples, step by step." %}

{% comment %}
The sections below are drafts, hidden from the built page until they are
written. Move a section out of this block to publish it.

## Distributional

<div class="plan-note" markdown="1">
- Examples
- Conflation: 2D example maybe
- Then the IMM vs BigGAN
</div>

## Disentangled

<div class="plan-note" markdown="1">
- Why they exist. Formulation
- Problems, refer to the 2D pentagon
- Image distortion
</div>

{% endcomment %}

## Chamfer

{% include chamfer/nn-explorer.liquid direction="fidelity" caption="Generated images are samples from IMM-XL with 8 steps <d-cite key='zhou2025inductive'></d-cite>, and real images are from ImageNet-1K. We use Inception-v3 features to find the nearest neighbours." %}

{% include chamfer/nn-explorer.liquid direction="coverage" caption="Generated images are samples from IMM-XL with 8 steps <d-cite key='zhou2025inductive'></d-cite>, and real images are from ImageNet-1K. We use Inception-v3 features to find the nearest neighbours." %}

{% comment %}
Still to write in the Chamfer section: the formulation (just give the formula).
{% endcomment %}

## Benchmarking modern models

{% include chamfer/ranking-chart.liquid caption="Chamfer-Fidelity and Chamfer-Coverage on ImageNet 256, from 100K generated samples, computed with cosine distance on DINOv2-Giant features and multiplied by 100. Lower is better on both, and marker area is proportional to the number of parameters. Hover over a model to see its samples; click to keep them in view." %}

## Interpretability of Chamfer

{% include chamfer/fidelity-density.liquid data="chamfer_class_density" images="/assets/chamfer-class/" stack=true %}

{% include chamfer/fidelity-density.liquid %}

{% include chamfer/fidelity-density.liquid data="chamfer_coverage_density" images="/assets/chamfer-coverage/" note="Each row: the real image whose distance is closest to the marker, and the model's generated sample nearest to it." %}

{% comment %}
Code and a full write-up are coming soon.
{% endcomment %}
