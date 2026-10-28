import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { leakEstimate, leakSentence, readAmount } from "../../../shared/outreach-case";

const blank = { leadsPerMonth: "", costPerLead: "", leakPercent: "", jobValue: "", bookedPercent: "" };

describe("readAmount", () => {
  it("reads numbers the way people write them", () => {
    assert.equal(readAmount("R1,714"), 1714);
    assert.equal(readAmount("R 2 500"), 2500);
    assert.equal(readAmount("20%"), 20);
    assert.equal(readAmount("129.50"), 129.5);
    assert.equal(readAmount("about a hundred"), undefined);
    assert.equal(readAmount(""), undefined);
  });
});

describe("leakEstimate", () => {
  it("says nothing until enquiries, their cost and the share lost are known", () => {
    assert.equal(leakEstimate(blank), undefined);
    assert.equal(leakEstimate({ ...blank, leadsPerMonth: "100", costPerLead: "R129" }), undefined);
    assert.equal(leakEstimate({ ...blank, leadsPerMonth: "100", costPerLead: "R129", leakPercent: "120%" }), undefined);
  });

  it("works out the wasted spend, and the lost jobs when the job value and booking rate are given", () => {
    const spendOnly = leakEstimate({ ...blank, leadsPerMonth: "100", costPerLead: "R129", leakPercent: "20%" });
    assert.deepEqual(spendOnly, { lostEnquiries: 20, wastedSpend: 2580 });
    assert.equal(leakSentence(spendOnly!), "About 20 enquiries a month leave the site without calling: R2 580 of ad spend a month.");

    const full = leakEstimate({ leadsPerMonth: "100", costPerLead: "R129", leakPercent: "20%", jobValue: "R1,700", bookedPercent: "40%" });
    assert.equal(full?.lostJobs, 8);
    assert.equal(full?.lostRevenue, 13600);
    assert.equal(leakSentence(full!), "About 20 enquiries a month leave the site without calling: R2 580 of ad spend a month, and about 8 jobs worth R13 600.");
  });
});
