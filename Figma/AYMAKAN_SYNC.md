# Aymakan daily productivity import

This workflow uses the Aymakan Shipping Export CSV and does not require an API or browser automation.

## Daily use

1. Open `https://admin-almshrf.aymakan.com.sa/shipping-export/create`.
2. Create the immediate-processing export for Barq, ELM, and Elm - Express. Set **Received Date Range** to the required single day.
3. Create the validation export for Al Mawarid Manpower Co, Neoleap, and Urpay. Leave **Received Date Range** blank so older receipts validated on the selected day remain available.
4. Download both completed CSV files from Aymakan.
5. In GEOTRACK, open **Productivity** and select the work date.
6. Choose **Import Barq / ELM** for the Receiving Date export.
7. Choose **Import Validation Clients** for the full Urpay, Neoleap, and Al Mawarid export. It stages every date from the first complete calendar month through the latest date. If the file begins partway through an older month, validations from that partial month still count as processed but do not reduce GEOTRACK backlog because their receipts are absent from the file.
8. **Import Barq / ELM** accepts either one receiving day or an overall export containing many receiving dates. Each date is counted independently using Receiving Date.
9. Select **Save & finalize imported data** once. GEOTRACK splits staged dates into chronological monthly batches, finalizes every imported day, and updates the dashboards without requiring one-by-one day finalization.
10. A combined portal export is also accepted. Each import button uses only its own client group and ignores rows belonging to the other group.
11. The monthly save preserves the other client group's values, notes, DSP allocations, and each date's draft/finalized status.

## Applied rules

- A shipment is received when it appears under the selected day's **Received At** filter.
- Duplicate tracking numbers are counted once.
- Cancelled, returned, and RTO shipments remain included.
- Urpay, Neoleap, and Al Mawarid received volume uses **Receiving Date**; processed volume uses **Validation Date**. A shipment received earlier and validated on the selected day counts as processed on the selected day.
- Each validation-client receipt batch closes on the 25th of the following month. For example, the September batch closes on October 25. Only the unvalidated remainder is removed from active backlog; historical received and processed totals remain unchanged.
- A validation that occurs after its batch closed still counts as processed/handover on its Validation Date, but does not reduce backlog a second time.
- Barq and ELM received and processed volume both use **Receiving Date**.
- Only shipments processed on the selected day whose 3PL Provider is JNT are added to DSP partner allocation.
- The importer never assigns units to a non-JNT DSP partner.
- A row with status **MR-On hold** counts as both Returns received and Returns processed on its **Updated At** date.
- Barq/ELM turnaround is measured from **Receiving Date** to **LMD Handed Over At**. Validation-client turnaround is measured from **Validation Date** to **LMD Handed Over At**.
- Turnaround averages can be filtered by the export's **Destination WH** branch code.

## Operational notes

- The two imports are independent. Reimporting one group does not clear the other group's values.
- The importer stops if the wrong customer group is uploaded or if required Receiving Date or Validation Date columns are missing.
- Each Validation Clients calendar-month batch is atomic. Earlier monthly batches remain saved if a later month fails validation, so the error can be corrected and the same full file safely imported again.
- CSV shipment rows stay in the browser. Supabase stores daily client totals plus aggregate backlog-release, batch-closure, returns, DSP, and turnaround totals only; no tracking numbers, addresses, statuses, or raw CSV rows are persisted.
- ELM and Elm - Express are combined under the ELM client. Al Mawarid Manpower Co maps to Al Mawarid.
- Always review the import preview, especially duplicate and unmatched-customer warnings, before finalizing.
