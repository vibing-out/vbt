# Receipt

What the voter takes home, in two forms: a digital pass on screen and a one-ink printed slip. It proves a ballot's journey, never its choices.

- **Consumer provides:** county, election name and date, precinct, the tracking code, and the tracker address and phone number (print only).
- **Digital pass** (`.vbt-pass`): `surface-inverse` at `radius-lg` with a `brand-orange` stripe on top; county and "Ballot receipt"; the code in mono on one line; election, date and precinct as three small facts; a perforated tear line with notches; the QR code on an `on-inverse` tile; the promise line. Modeled on a wallet ticket.
- **Printed slip** (`.vbt-slip`): one ink, solid rules, readable in black and white; county, election, precinct, code, QR, address and phone, promise line.
- The promise line is fixed: "Shows your ballot's progress. Does not show how you voted."
- Never show choices, the time of voting, the voter's name, or anything that reveals casting order.
- The printed slip matches the receipt mockup in the playbook (Overview > Voter journey): readable code, QR, web address, phone line. T-07 tests that it holds no choices or time.
- If the phone tracker (T-17, stretch) ships, the slip also prints a numeric version of the code for keypad entry, labeled "Phone code", below the phone number: 16 digits in groups of four ("7482-6619-0354-2817"). The code generator (T-05) defines how the word code maps to digits; the slip only prints it. Without T-17, leave the row out.
- The address and phone number are placeholders for a county's own. Lost receipts can't be recovered, by design.
