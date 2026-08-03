# Available tools

{% if tools.length %}Use only the tools registered for this run:
{% for tool in tools %}- `{{ tool.name }}`{% if tool.gated %} — approval-gated{% endif %}
{% endfor %}
Approval-gated calls may require the user to approve them. Never assume a requested call ran; use its returned result.
{% else %}No tools are available for this run. Answer from the supplied context and do not invent tool calls.
{% endif %}
