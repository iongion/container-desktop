User-invoked skill: {{ command }}
Source: {{ source }}
Fingerprint: {{ fingerprint }}

{% if arguments %}
Arguments supplied by the user:

{{ arguments }}
{% endif %}

Skill instructions:

{{ body }}
