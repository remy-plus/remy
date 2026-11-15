# Location

Remy can use your rough location for things nearby: "look for ramen spots nearby", "what is open now", "will it rain" with no place named. It is off until you allow it.

## How it is asked for

The web app asks your browser for your position the first time a message needs it (words like nearby, near me, around here, open now, local restaurants, or weather with no place), or when you press Turn on location in Settings > Location. It shows one line before the browser's own question: "Remy uses your rough location for things nearby. It is kept on your server." If you say no, the chat never asks again; only Settings > Location can turn it back on. The terminal never asks. Your time zone is not treated as a location, and Remy does not guess one.

## What is stored, and where

One file on the machine that runs Remy: `location.json` in your Remy folder (`~/.remy` unless `REMY_HOME` says otherwise), readable only by you. It holds:

- the place name, such as "Philadelphia, Pennsylvania, US" (or "near 39.95, -75.16" when no name could be found),
- the position rounded to two decimals, about one kilometre,
- when it was set.

Your browser sends the position rounded to two decimals, and the server rounds it again, so a precise fix is never stored. The server never sends the coordinates back to the web app.

The one outside request: the server asks OpenStreetMap's reverse geocoder (`nominatim.openstreetmap.org`) for the place name, once for each new position, with only the rounded coordinates and Remy's generic User-Agent, at most one request a second, through the same guard that keeps Remy's fetch tool off private addresses. No account, key or personal detail is sent. Answers are cached for the session, and an unchanged position is not looked up again. The browser's own position lookup is done by your browser and its vendor, as for any website.

The model sees one line in each message while a place is set: `Where the person is: Philadelphia, Pennsylvania, US (approximate, set 2 days ago).` Like the rest of the message, it goes to the model you chose. With no place set, the line is absent.

## Seeing, updating and removing it

- Settings > Location shows the place and when it was set, with Update (asks the browser again) and Turn off.
- Turn off deletes the place, the coordinates and the time, and leaves only a note that you declined, so the chat does not ask again. Turn on location starts over.
- To remove it by hand, delete `location.json`. Remy then asks again the next time a message needs a place.
- API: `GET`, `PUT` and `DELETE /api/location`, and `POST /api/location/decline`, behind the same token, Host and cross-site checks as every other route.
