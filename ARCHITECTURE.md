# Architecture notes

## Common

* Use the right tool for the job, whatever it maybe, the goal is the tool, not the bricks used to make it.
* Be smart, not clever.
* No backend clutter, no wobbling UI
* Model types as close to the domain as possible

## Frontend

* Friendly and familiar UI
* Avoid pop-ups at all costs
* Integrate natively as much as it is healthy
* Use all input indicators and devices properly (tab order, hot-keys, mouse/touchpad and keyboard - limit usage of context menus to known patterns only)

## Backend

* Security comes first
* Use ipc and secure connections to service
* Prefer unix domain socket to local running http api and websocket servers. They spare ports and are more robust and secure.
