// deno run -A --unstable --cert ./assets/riotgames.pem leagueAssist.ts

import { existsSync } from "https://deno.land/std/fs/mod.ts";
import "./assets/definitions.ts";
import { APIData } from "./assets/apiDefinitions.ts";
// import { encode } from "https://deno.land/std@0.81.0/encoding/base64.ts";

// VARIABLES / FS MODULES

const procName = "League of Legends.exe",
  readFile = (path: string): Promise<string> => Deno.readTextFile(path),
  writeJson = (path: string, data: object, spacing: number = 2): void => {
    try {
      Deno.writeTextFileSync(path, JSON.stringify(data, null, spacing));
    } catch {
      console.log(
        `Error: can't write to ${path || "unknown"}, data will not be saved.`
      );
    }
  };

let config: configData,
  firstConfig = true, // don't reset
  firstRun = true, // don't reset
  firstFetch = true,
  gameAPIfailing = false,
  oldData: Rito.RootObject,
  activePlayer: Rito.AllPlayer,
  championName: string;

// OPERATION / PATH / LOADED FILE ENUMS

const paths = {
  TTS: "./assets/tts.vbs",
  CONFIG: "./assets/config.json",
  SKILL_ORDER: "./assets/skillorder.json",
  CHAMPIONS: "./assets/champions.json",
  BUILDS: "",
};

let ops: any, load: { SKILL_ORDER: SkillOrder[]; CHAMPIONS: Champion[] };

const abilities = new Map([
  ["1", "Q"],
  ["2", "W"],
  ["3", "E"],
  ["4", "R"],
]);

// HELPER FUNCTIONS

function say(text: string): void {
  if (!existsSync(paths.TTS)) {
    console.log("Text-to-speech VBScript file doesn't exist, exiting...");
    Deno.exit(1);
  }
  Deno.run({
    cmd: ["cscript.exe", paths.TTS, text],
    stdout: "null",
    stderr: "null",
  });
  console.log(`• ${text}`);
}

async function isInGame(): Promise<boolean> {
  const proclist = Deno.run({
    cmd: ["tasklist.exe"],
    stdout: "piped",
    stderr: "null",
  });

  const output = new TextDecoder("utf-8").decode(await proclist.output());

  return output.toLowerCase().indexOf(procName.toLowerCase()) > -1;
}

/*async function isInClient(): Promise<string[] | number> {
  /* -1 = No client detected
      1 = No data included
      2 = Error with authentication to such data 

  return new Promise(async function (resolve, reject) {
    const proclist = Deno.run({
      cmd: [
        "wmic.exe",
        "PROCESS",
        "WHERE",
        "name='LeagueClientUx.exe'",
        "GET",
        "commandline",
      ],
      stdout: "piped",
      stderr: "null",
    });

    const output = new TextDecoder("utf-8").decode(await proclist.output());

    if (output.toLowerCase().includes("no instance")) reject(-1);

    if (output.includes("--")) {
      if (
        /--remoting-auth-token=([\w\-_]*)/.test(output) &&
        /--app-port=([0-9]*)/.test(output)
      ) {
        try {
          const port = (output.match(/--app-port=([0-9]*)/) as any[])[1],
            token = (output.match(
              /--remoting-auth-token=([\w\-_]*)/
            ) as any[])[1],
            headers = new Headers();

          headers.set("Authorization", "Basic " + encode("riot:" + token));

          fetch(`https://localhost:${port}/lol-summoner/v1/current-summoner`, {
            method: "GET",
            headers: headers,
          })
            .then(async (response) => {
              console.log(response.statusText);
              if (response.ok) resolve([port, token]);
              else reject(2);
            })
            .catch((err) => {
              console.log(err);
              reject(2);
            });
        } catch {
          reject(1);
        }
      } else reject(1);
    } else reject(1);
  });
}*/

// MAIN FUNCTIONS

function apiFeed(): void {
  let i = 0;
  const apiLoop = setInterval(function () {
    const leagueAPI = fetch(
      "https://localhost:2999/liveclientdata/allgamedata"
    );

    leagueAPI
      .then((response) => {
        if (gameAPIfailing) gameAPIfailing = false;
        return response.json();
      })
      .then((jsonData) => {
        if (i > 0) i = 0;
        dataHandler(jsonData);
      })
      .catch(() => {
        if (!gameAPIfailing) gameAPIfailing = true;
        i++;
        if (i > 14) {
          clearInterval(apiLoop);
          i = 0;
          firstRun = false;
          main();
        }
      });
  }, 1000);
}

async function tryAttach(): Promise<void> {
  return new Promise(async function (resolve) {
    if (await isInGame()) {
      // avoiding spam when game is running but its API didn't init yet
      if (!gameAPIfailing) console.log("Detected! Proceeding...");
      console.log("\n");
      resolve();
    } else {
      if (!firstRun) console.clear();
      console.log("Monitoring for client...");
      const retry = setInterval(async function () {
        if (await isInGame()) {
          clearInterval(retry);
          console.log("Detected! Proceeding...");
          console.log("\n");
          resolve();
        }
      }, 5000);
    }
  });
}

async function dataHandler(data: Rito.RootObject): Promise<void> {
  try {
    if (data?.errorCode === "RESOURCE_NOT_FOUND") return;

    // instantly save in the first fetch to avoid issues in runtime
    if (firstFetch) {
      oldData = data;
      firstFetch = false;
    }
    if (!ops.SKILL_ORDER_LOADED) {
      load.SKILL_ORDER = JSON.parse(await readFile(paths.SKILL_ORDER));
      ops.SKILL_ORDER_LOADED = true;
    }
    if (!ops.CHAMPIONS_LOADED) {
      load.CHAMPIONS = JSON.parse(await readFile(paths.CHAMPIONS));
      ops.CHAMPIONS_LOADED = true;
    }
    if (championName === "") {
      try {
        activePlayer = data.allPlayers.find(
          (player) => player.summonerName === data.activePlayer.summonerName
        ) as Rito.AllPlayer;
        championName = activePlayer.championName;
      } catch {
        console.log("Champion name couldn't be found.");
        return;
      }
    }

    // detect if player's level has increased since the last time
    if (
      ((data.activePlayer.level > oldData.activePlayer.level &&
        data.activePlayer.level > ops.UPGRADE_SKILL) ||
        data.activePlayer.level > ops.UPGRADE_SKILL) &&
      ops.UPGRADE_SKILL < 15
    ) {
      let championKey = "",
        skillorder = [];
      try {
        (championKey = load.CHAMPIONS.find(
          (champion) => champion.name === championName
        )?.key as string),
          (skillorder = load.SKILL_ORDER.find(
            (skill) => skill.key === championKey
          )?.data as string[]);
      } catch {
        console.log("Champion data wasn't found, leaving...");
        Deno.exit(1);
      }

      const displayName = new Map([
        ["1", data.activePlayer.abilities.Q.displayName],
        ["2", data.activePlayer.abilities.W.displayName],
        ["3", data.activePlayer.abilities.E.displayName],
        ["4", data.activePlayer.abilities.R.displayName],
      ]);

      if (
        championKey === "523" ||
        displayName.get(skillorder[ops.UPGRADE_SKILL])?.includes("{{")
      ) {
        say(`Upgrade your ${abilities.get(skillorder[ops.UPGRADE_SKILL])}`);
      } else {
        say(
          `Upgrade your ${abilities.get(
            skillorder[ops.UPGRADE_SKILL]
          )}, ${displayName.get(skillorder[ops.UPGRADE_SKILL])}`
        );
      }

      ops.UPGRADE_SKILL++; // <= actual skill level
    }
  } catch (error) {
    // Note: don't return, oldData will otherwise not change
    console.log(error);
  }
  oldData = data;
}

/* NEEDED TO ONLY UPDATE AFTER ASSETS HAVE BEEN UPDATED. GOTTA CHECK FIRST AND UPDATE LAST

  async function checkUpdate(): Promise<boolean> {
  return new Promise(async function (resolve) {
    if (firstConfig) {
      firstConfig = false;

    }
    else {
      resolve(false);
    }
  });
}*/

async function updateConfig(): Promise<boolean> {
  return new Promise(async function (resolve) {
    // avoid pinging rito for the patch every time while the code is still running
    if (firstConfig) {
      firstConfig = false;

      config = JSON.parse(await readFile(paths.CONFIG));
      let versions: string[], version: string;

      const fetchedData = fetch(
        "https://ddragon.leagueoflegends.com/api/versions.json"
      );

      fetchedData.catch(() => {
        console.log("Couldn't fetch the latest patch, config won't update.");
        resolve(false);
      });

      versions = await fetchedData.then((response) => {
        return response.json();
      });

      if (versions?.length > 0) {
        try {
          version =
            versions[0].replace(/[^.]/g, "").length > 1
              ? versions[0].substr(0, versions[0].lastIndexOf("."))
              : versions[0];

          if (version != config.patchVersion) {
            console.log(
              `New patch detected : ${version}, current patch : ${config.patchVersion}`
            );
            config.patchVersion = version;
            config.rawPatchVersion = versions[0];
            writeJson(paths.CONFIG, config);
            resolve(true);
          } else {
            resolve(false);
          }
        } catch (error) {
          resolve(false);
        }
      } else {
        resolve(false);
      }
    } else {
      resolve(false);
    }
  });
}

async function updateChampions(): Promise<void> {
  return new Promise(async function (resolve, reject) {
    try {
      const request = fetch(
        `http://ddragon.leagueoflegends.com/cdn/${config.rawPatchVersion}/data/en_US/champion.json`
      );

      request.catch(() => {
        console.log(
          "Couldn't fetch champions.json from ddragon, assets won't update..."
        );
        reject();
      });

      const champions = await request.then((response) => {
        if (existsSync(paths.CHAMPIONS)) Deno.remove(paths.CHAMPIONS);
        return response.json();
      });

      const parentObj = [];

      if (champions) {
        const obj = Object.keys(champions.data).map((key) => [
          Number(key),
          champions.data[key],
        ]);
        for (const champion of obj) {
          const elm = {
            id: champion[1].id,
            name: champion[1].name,
            key: champion[1].key,
          };
          parentObj.push(elm);
        }
      }

      writeJson(paths.CHAMPIONS, parentObj, 0);

      const parentArr = [];

      for (const champion of parentObj) {
        const soRequest = fetch(
          `https://apix1.op.lol/mega/?ep=champion&v=${config.apiVersion}&patch=${config.patchVersion}&cid=${champion.key}&lane=default&tier=gold_plus`
        );

        soRequest.catch((error) => {
          console.log(
            "Couldn't fetch the skill order from op.lol, assets won't update..."
          );
          console.log(error);
          reject();
        });

        const fetchedData = await soRequest.then((response) => {
          if (existsSync(paths.SKILL_ORDER)) Deno.remove(paths.SKILL_ORDER);
          return response.json();
        });

        parentArr.push({
          key: champion.key,
          data: [...fetchedData.summary.skillorder.win.id.toString()],
        });
      }

      writeJson(paths.SKILL_ORDER, parentArr, 0);
      resolve();
    } catch {
      reject();
    }
  });
}

async function updateBuilds(): Promise<void> {
  return new Promise(async function (resolve, reject) {
    try {
      if (!ops.CHAMPIONS_LOADED) {
        load.CHAMPIONS = JSON.parse(await readFile(paths.CHAMPIONS));
        ops.CHAMPIONS_LOADED = true;
      }

      const lanes = ["aram", "top", "middle", "bottom", "jungle", "support"];

      if (!existsSync(paths.BUILDS)) {
        console.log(
          "Provided game directory is invalid, please change it in the config file."
        );
        Deno.exit(1);
      }

      console.log("\n");

      for (const champion of load.CHAMPIONS) {
        const buildDir = `${paths.BUILDS}/${champion.id}/Recommended`;

        if (!existsSync(buildDir)) {
          Deno.mkdirSync(buildDir, { recursive: true });
        }

        console.log(`* Updating builds for ${champion.name}`);

        for (const lane of lanes) {
          const buildFile = `${buildDir}/lolalytics_${champion.key}_${lane}.json`;

          const request = fetch(
            `https://apix1.op.lol/mega/?ep=champion&v=${config.apiVersion}&patch=7&cid=${champion.key}` +
              (lane === "aram"
                ? "&tier=all&queue=450"
                : `&tier=gold_plus&lane=${lane}`)
          );

          request.catch(() => {
            console.log(
              `Couldn't fetch build for ${champion.name}, builds won't update...`
            );
            reject();
          });

          const fetchedData: APIData = await request.then((response) => {
            if (existsSync(buildFile)) Deno.remove(buildFile);
            return response.json();
          });

          if (
            typeof fetchedData?.header?.n === "number" &&
            fetchedData?.header?.n <= 800
          ) {
            console.log(`- Skipping ${lane}`);
            continue;
          }

          if (!fetchedData.summary) continue;

          let build = {} as Build.RootObject;

          if (lane === "aram") {
            build = {
              title: `OP ${lane} ${config.patchVersion}`,
              type: "custom",
              map: "HA",
              mode: "any",
              priority: true,
              champion: champion.id,
              blocks: [],
            };
          } else {
            build = {
              title: `OP ${lane} ${config.patchVersion}`,
              type: "custom",
              map: "SR",
              mode: "any",
              priority: fetchedData?.header?.defaultLane === lane,
              champion: champion.id,
              blocks: [],
            };
          }

          // Viable = win, Frequent = pick

          if (fetchedData.summary.items?.win?.start?.set?.length) {
            const start: Array<{ count: number; id: string }> = [];

            for (const item of fetchedData.summary.items.win.start.set) {
              start.push({ count: 1, id: item.toString() });
            }

            build.blocks.push({
              type: `Viable Starting Items${
                fetchedData.summary.skillpriority?.win &&
                " | Skill Priority: " + fetchedData.summary.skillpriority.win.id
              }`,
              items: start,
            });
          }

          if (fetchedData.summary.items?.win?.core?.set?.length) {
            const core: Array<{ count: number; id: string }> = [];

            for (const item of fetchedData.summary.items.win.core.set) {
              core.push({ count: 1, id: item.toString() });
            }

            build.blocks.push({
              type: `Viable Core Build | Laning Items Excluded`,
              items: core,
            });
          }

          if (fetchedData.summary.items?.win?.item4?.length) {
            const four: Array<{ count: number; id: string }> = [];

            for (const item of fetchedData.summary.items.win.item4) {
              four.push({ count: 1, id: item.id.toString() });
            }

            build.blocks.push({
              type: `Viable 4th Item | Any`,
              items: four,
            });
          }

          if (fetchedData.summary.items?.win?.item5?.length) {
            const five: Array<{ count: number; id: string }> = [];

            for (const item of fetchedData.summary.items.win.item5) {
              five.push({ count: 1, id: item.id.toString() });
            }

            build.blocks.push({
              type: `Viable 5th Item | Any`,
              items: five,
            });
          }

          if (fetchedData.summary.items?.win?.item6?.length) {
            const six: Array<{ count: number; id: string }> = [];

            for (const item of fetchedData.summary.items.win.item6) {
              six.push({ count: 1, id: item.id.toString() });
            }

            build.blocks.push({
              type: `Viable 6th Item | Any`,
              items: six,
            });
          }

          if (fetchedData.summary.items?.pick?.start?.set?.length) {
            const start: Array<{ count: number; id: string }> = [];

            for (const item of fetchedData.summary.items.pick.start.set) {
              start.push({ count: 1, id: item.toString() });
            }

            build.blocks.push({
              type: `Frequent Starting Items${
                fetchedData.summary.skillpriority?.pick &&
                " | Skill Priority: " +
                  fetchedData.summary.skillpriority.pick.id
              }`,
              items: start,
            });
          }

          if (fetchedData.summary.items?.pick?.core?.set?.length) {
            const core: Array<{ count: number; id: string }> = [];

            for (const item of fetchedData.summary.items.pick.core.set) {
              core.push({ count: 1, id: item.toString() });
            }

            build.blocks.push({
              type: `Frequent Core Build | Laning Items Excluded`,
              items: core,
            });
          }

          if (fetchedData.summary.items?.pick?.item4?.length) {
            const four: Array<{ count: number; id: string }> = [];

            for (const item of fetchedData.summary.items.pick.item4) {
              four.push({ count: 1, id: item.id.toString() });
            }

            build.blocks.push({
              type: `Frequent 4th Item | Any`,
              items: four,
            });
          }

          if (fetchedData.summary.items?.pick?.item5?.length) {
            const five: Array<{ count: number; id: string }> = [];

            for (const item of fetchedData.summary.items.pick.item5) {
              five.push({ count: 1, id: item.id.toString() });
            }

            build.blocks.push({
              type: `Frequent 5th Item | Any`,
              items: five,
            });
          }

          if (fetchedData.summary.items?.pick?.item6?.length) {
            const six: Array<{ count: number; id: string }> = [];

            for (const item of fetchedData.summary.items.pick.item6) {
              six.push({ count: 1, id: item.id.toString() });
            }

            build.blocks.push({
              type: `Frequent 6th Item | Any`,
              items: six,
            });
          }

          writeJson(buildFile, build, 0);
        }
      }

      console.log("\n");

      resolve();
    } catch {
      reject();
    }
  });
}

async function updateAssets(): Promise<void | void[]> {
  return Promise.all([updateChampions(), updateBuilds()]).catch((err) => {
    console.log(err);
    Deno.exit(1);
  });
}

// CLIENT SPECIFIC CODE
async function updateRunes(): Promise<void> {
  return new Promise(async function (resolve, reject) {
    try {
    } catch {}
  });
}

// PROMISELAND
const main = async (): Promise<void> => {
  firstFetch = true;
  championName = "";

  ops = {
    UPGRADE_SKILL: 0, // level at time of assisted skill upgrade, max = 15
    SKILL_ORDER_LOADED: false, // to make sure the json file doesn't load twice
    CHAMPIONS_LOADED: false, // to make sure the json file doesn't load twice
  };
  load = {
    SKILL_ORDER: [],
    CHAMPIONS: [],
  };

  //todo: ifExists() to check if files exist and updateChampions if they don't

  try {
    config = JSON.parse(await readFile(paths.CONFIG));
  } catch {
    console.log("Can't load the config file, terminating...");
    Deno.exit(1);
  }

  paths.BUILDS = `${config.gameDir}/Config/Champions`;

  if (await updateConfig()) await updateAssets();

  await tryAttach().then(() => {
    apiFeed();
  });
};

console.clear();
console.log("<================= LeagueAssist =================>\n");
main();
