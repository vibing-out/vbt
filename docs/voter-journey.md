# Voter journey

A hypothetical voter at Precinct 12 in Marion County, with ElectionGuard and our tracker. This is the brief for T-07 (receipt) and T-08 (tracker). The contracts these build against are in [`locked-interfaces.md`](locked-interfaces.md).

1. **Vote as usual.** Check in, mark the ballot on the machine, review the printed paper ballot. Optionally spoil a ballot to test the machine: it is decrypted so the voter sees it was encrypted correctly, then they vote again.
2. **Cast.** The paper ballot goes in the ballot box; ElectionGuard encrypts the electronic copy.
3. **Take the receipt.** A separate, differently colored slip, as in the Fulton, Wisconsin pilot.
4. **Track it** from the QR code, the printed web address, or the toll-free line (stretch, T-17), where a voice agent reads back the live status.

## Receipt mockup

```
 MARION COUNTY GENERAL ELECTION · NOV 3, 2026
 Precinct 12

 Your ballot tracking code:
   RIVER-MAPLE-7Q4K-HAWK

 [ QR CODE ]

 Track it:  vote.marion.in.gov/track
 Or call:   1-800-555-0100
 Phone code: 4821 9937 06
 Text updates: text TRACK + your code
               to 1-800-555-0100

 This code shows your ballot's progress.
 It does not show how you voted.
```

- The QR code opens that ballot's tracking page directly; the printed address and phone line serve voters without smartphones.
- The printed code is a short, readable form of ElectionGuard's long confirmation code.
- Never on the receipt: choices, time of voting, name.

## What the tracker shows

| When | Tracker shows |
| --- | --- |
| Right after voting | Cast and sealed; encrypted ballot recorded |
| Election night, after polls close | Counted at Precinct 12 |
| Later that night | Included in Marion County's election-night results, with a link to the published record |
| Up to about 2 weeks later | Certified (in 2024, certified results were due to the state by noon Nov 18) |
| If it happens | Challenged or discarded, with the reason |

Each stage also shows that the encrypted ballot is unchanged and included in that stage's public record.

## Design rules

- No accounts. Text updates (T-18) are opt-in and voter-initiated, warn that they link a phone number to the code, and are deleted at certification; text-to-check stores nothing.
- Lost receipts cannot be recovered, by design.
- Sharing or photographing a receipt is safe; it proves nothing about the vote.
- In production the tracker runs on the county's or state's own domain; we provide the software.
- Anyone can download the full public record and check it with the independent verifier (T-15).
- The address and phone number in the mockup are placeholders.
