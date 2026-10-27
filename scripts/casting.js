import { escapeHtml, asIntFloor } from "./utils.js";
import { evalCost, hasLettersBesidesVariable } from "./costs.js";
import { getFirstTargetToken, getMP, pathsForResources, updateActorResource } from "./actor.js";
import { rollPOWCheck, opposedResult, degreeLabel, degreeColor } from "./checks.js";

// A client cannot start another cast for this actor while costs are being paid.
const castingActors = new Set();
export async function castSpellCore(options) {
  const key = options.casterActor?.uuid;
  if (castingActors.has(key)) return { ok: false };
  castingActors.add(key);
  try { return await performCast(options); }
  catch (error) {
    console.error("Cthulhu Spell Reader | Cast failed", error);
    ui.notifications.error("Nie udało się rzucić zaklęcia. Sprawdź zasoby aktora i konsolę.");
    return { ok: false };
  } finally { castingActors.delete(key); }
}

async function performCast({ casterToken, casterActor, spell, hasTargetNow, variableValue }) {
  if (!casterActor?.isOwner || spell?.parent?.uuid !== casterActor.uuid || spell.type !== "spell") {
    ui.notifications.warn("Nie masz uprawnień do rzucania tego zaklęcia.");
    return { ok: false };
  }
  if (spell.system?.costList?.length) {
    ui.notifications.warn("To zaklęcie używa automatycznych kosztów costList. Rzuć je z karty systemowej CoC7.");
    return { ok: false };
  }
  const costsRaw = spell.system?.costs ?? {};
  const castingTime = spell.system?.castingTime ?? "";

  const targetToken = hasTargetNow ? getFirstTargetToken() : null;
  if (hasTargetNow && !targetToken?.actor) {
    ui.notifications.warn("Zaklęcie ma cel: wskaż cel jako Target (T).");
    return { ok: false };
  }

  const costHP = await evalCost(costsRaw.hitPoints, variableValue);
  const costMP = await evalCost(costsRaw.magicPoints, variableValue);
  const costSAN = await evalCost(costsRaw.sanity, variableValue);
  const costPOW = await evalCost(costsRaw.power, variableValue);
  const costOther = hasLettersBesidesVariable(costsRaw.others)
  ? { amount: 0, detail: String(costsRaw.others ?? ""), raw: String(costsRaw.others ?? "") }
  : await evalCost(costsRaw.others, variableValue);

  const totalHP = costHP.amount;
  const totalMP = costMP.amount;
  const totalSAN = costSAN.amount;
  const totalPOW = costPOW.amount;
  const totalOther = costOther.amount;

  const p = pathsForResources();

  const curMP = asIntFloor(getMP(casterActor));
  const mpPaid = Math.min(Math.max(0, curMP), totalMP);
  const mpRemainder = Math.max(0, totalMP - mpPaid);

  if (mpPaid > 0) await updateActorResource(casterActor, p.mp, mpPaid);

  const hpToPay = totalHP + mpRemainder;
  if (hpToPay > 0) await updateActorResource(casterActor, p.hp, hpToPay);

  if (totalSAN > 0) await updateActorResource(casterActor, p.san, totalSAN);
  if (totalPOW > 0) await updateActorResource(casterActor, p.pow, totalPOW);

  const casterPowCheck = await rollPOWCheck(casterActor);

  let spellSucceeded = casterPowCheck.success;
  let spellHit = true;
  let targetPowCheck = null;
  let opposedWinner = null;

  if (hasTargetNow) {
    targetPowCheck = await rollPOWCheck(targetToken.actor);
    opposedWinner = opposedResult(casterPowCheck, targetPowCheck);
    spellHit = (spellSucceeded && opposedWinner === "caster");
  }

  const outcome = !spellSucceeded ? "fail" : (hasTargetNow && !spellHit ? "resisted" : "hit");

  const costLines = [
    totalMP ? `MP: -${totalMP} <br><span style="opacity:.8;font-size:12px;">${escapeHtml(costMP.detail)}</span>` : `MP: 0`,
    totalHP ? `HP: -${totalHP} <br><span style="opacity:.8;font-size:12px;">${escapeHtml(costHP.detail)}</span>` : `HP: 0`,
    mpRemainder ? `HP (za brak MP): -${mpRemainder}` : null,
    totalSAN ? `SAN: -${totalSAN} <br><span style="opacity:.8;font-size:12px;">${escapeHtml(costSAN.detail)}</span>` : `SAN: 0`,
    totalPOW ? `POW: -${totalPOW} <br><span style="opacity:.8;font-size:12px;">${escapeHtml(costPOW.detail)}</span>` : `POW: 0`,
    (totalOther || costOther.raw) ? `Other: ${totalOther} (tylko raport) <br><span style="opacity:.8;font-size:12px;">${escapeHtml(costOther.detail)}</span>` : null
  ].filter(Boolean).join("<br>");

  const casterDeg = degreeLabel(casterPowCheck.degree);
  const casterDegColor = degreeColor(casterPowCheck.degree);

  const targetDeg = targetPowCheck ? degreeLabel(targetPowCheck.degree) : null;
  const targetDegColor = targetPowCheck ? degreeColor(targetPowCheck.degree) : "white";

  const descHtml = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
    spell.system?.description?.value ?? "<i>Brak opisu.</i>",
    { secrets: false, rolls: true, relativeTo: spell }
  );

  const resultBlock = `
    <h2 style="margin:0 0 6px;">${escapeHtml(spell.name)}</h2>
    <div style="opacity:.85; margin-bottom:6px;"><b>Casting Time:</b> ${escapeHtml(castingTime || "-")}</div>

    <div style="border:1px solid #444; border-radius:10px; padding:10px; margin:8px 0;">
      <b>Test MOC (caster)</b>: ${casterPowCheck.total} vs ${casterPowCheck.pow} →
      <b style="color:${casterDegColor};">${casterDeg}</b>
      ${hasTargetNow ? `<br><b>Test MOC (cel)</b>: ${targetPowCheck.total} vs ${targetPowCheck.pow} → <b style="color:${targetDegColor};">${targetDeg}</b>` : ""}
      ${hasTargetNow ? `<br><b>Przeciwny test:</b> ${opposedWinner === "caster" ? "Caster wygrywa" : "Cel odpiera"}` : ""}
      <br><b>Wynik czaru:</b> ${
        !spellSucceeded ? `<b style="color:tomato;">NIE WYSZEDŁ</b>` :
        (hasTargetNow && !spellHit) ? `<b style="color:orange;">WYSZEDŁ, ALE NIE TRAFIŁ</b>` :
        `<b style="color:lime;">WYSZEDŁ</b>`
      }
    </div>

    <div style="border:1px solid #444; border-radius:10px; padding:10px; margin:8px 0;">
      <b>Koszty (zawsze płacone):</b><br>
      ${costLines}
      <hr style="border:none;border-top:1px solid #333;margin:8px 0;">
      <div style="opacity:.8; font-size:12px;">
        Raw: HP(${escapeHtml(costsRaw.hitPoints)}), MP(${escapeHtml(costsRaw.magicPoints)}),
        SAN(${escapeHtml(costsRaw.sanity)}), POW(${escapeHtml(costsRaw.power)}), Other(${escapeHtml(costsRaw.others)})
      </div>
    </div>

    <details open style="border:1px solid #444; border-radius:10px; padding:10px;">
      <summary style="cursor:pointer;"><b>Opis zaklęcia</b></summary>
      <div style="margin-top:8px;">
        ${descHtml}
      </div>
    </details>
  `;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: casterActor, token: casterToken.document }),
    content: resultBlock
  });

  return { ok: true, outcome };
}
