import express from "express";
import { LeadMagnetInputSchema, NewLeadMagnetSchema } from "../../shared/lead-magnet-types";
import { findStoredAsset } from "../designs/library";
import { draftLeadMagnet } from "./lead-magnet-draft";
import {
  createLeadMagnet,
  deleteLeadMagnet,
  readLeadMagnet,
  replaceLeadMagnet,
  startLeadMagnetExperiment,
} from "./lead-magnet-store";
import { leadMagnetFiles } from "./lead-magnets";
import { fail, parse } from "./route-helpers";
import { buildZip } from "./zip";

/**
 * `/api/traction/lead-magnets`.
 *
 * Bodies are parsed with the shared schemas; ids in paths are only ever
 * looked up in the store. Nothing here publishes anything: the export is a
 * download a person commits to the site themselves.
 */
export const leadMagnetRouter = express.Router();

leadMagnetRouter.post("/", async (request, response) => {
  const input = parse(NewLeadMagnetSchema, request.body, response, "lead magnet");
  if (!input) return;

  try {
    response.status(201).json({ leadMagnet: await createLeadMagnet(input) });
  } catch (error) {
    fail(response, error, "add the lead magnet");
  }
});

leadMagnetRouter.put("/:id", async (request, response) => {
  const input = parse(LeadMagnetInputSchema, request.body, response, "lead magnet");
  if (!input) return;

  try {
    // A cover Creative does not hold, or a video, is refused now rather than
    // exported as a missing image later.
    if (input.coverAssetId) {
      const asset = await findStoredAsset(input.coverAssetId);
      if (!asset || asset.mediaType === "video") {
        response.status(400).json({ error: `No image ${input.coverAssetId} in Creative` });
        return;
      }
    }
    response.json({ leadMagnet: await replaceLeadMagnet(request.params.id, input) });
  } catch (error) {
    fail(response, error, "save the lead magnet");
  }
});

leadMagnetRouter.delete("/:id", async (request, response) => {
  try {
    await deleteLeadMagnet(request.params.id);
    response.json({ ok: true });
  } catch (error) {
    fail(response, error, "delete the lead magnet");
  }
});

/** One Hermes call; fills empty fields only. */
leadMagnetRouter.post("/:id/draft", async (request, response) => {
  try {
    response.json({ leadMagnet: await draftLeadMagnet(request.params.id) });
  } catch (error) {
    fail(response, error, "draft the lead magnet");
  }
});

leadMagnetRouter.post("/:id/experiment", async (request, response) => {
  try {
    response.status(201).json(await startLeadMagnetExperiment(request.params.id));
  } catch (error) {
    fail(response, error, "start the experiment");
  }
});

/** `<slug>.json`, the cover, and a README: ready to drop into the site repository. */
leadMagnetRouter.get("/:id/export.zip", async (request, response) => {
  try {
    const magnet = await readLeadMagnet(request.params.id);
    const { entries, coverSkipped } = await leadMagnetFiles(magnet);
    response.setHeader("Content-Type", "application/zip");
    response.setHeader("Content-Disposition", `attachment; filename="lead-magnet-${magnet.slug}.zip"`);
    if (coverSkipped) response.setHeader("X-Cover-Skipped", "1");
    response.send(buildZip(entries));
  } catch (error) {
    fail(response, error, "export the lead magnet");
  }
});
