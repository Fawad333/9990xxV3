import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import { scrapeListing } from './text.js';
import axios from 'axios';

puppeteer.use(StealthPlugin());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = 'https://www.olx.com.pk';

// Read the file name passed from the parent process (run.js)
const outputFileName = process.argv[2];
const outputFilePath = path.resolve(__dirname, 'data', outputFileName);

// Ensure the 'data' directory exists
if (!fs.existsSync(path.resolve(__dirname, 'data'))) {
    fs.mkdirSync(path.resolve(__dirname, 'data'));
}

const visitedUrls = new Set();

// Function to save the data to the CSV file
const saveToCSV = (data) => {
    if (data.length === 0) return;

    try {
        const headers = Object.keys(data[0]).join(',') + '\n';
        const csvData = data.map((row) => Object.values(row).join(',')).join('\n');

        const fileExists = fs.existsSync(outputFilePath);
        if (!fileExists) {
            fs.writeFileSync(outputFilePath, headers + csvData + '\n');
        } else {
            fs.appendFileSync(outputFilePath, csvData + '\n');
        }

        console.log(chalk.white(`Data saved to ${outputFilePath}`));
    } catch (error) {
        console.error(chalk.red(`Error saving data: ${error.message}`));
    }
};

// Function to upload the file to GitHub
const uploadToGitHub = async (localFilePath, githubConfig) => {
    // (same as before)
};

const scrapeChildPages = async (parentUrl) => {
    try {
        const browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
            ],
        });
        const page = await browser.newPage();

        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
                req.abort();
            } else {
                req.continue();
            }
        });

        await page.goto(parentUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForSelector("#body-wrapper", { timeout: 30000 });

        await page.evaluate(() => window.scrollBy(0, window.innerHeight));
        await page.waitForSelector("#body-wrapper li.undefined article > div:last-child > a", { timeout: 30000 });

        const content = await page.content();
        const $ = cheerio.load(content);

        const listings = [];
        $("#body-wrapper li.undefined article > div:last-child > a").each((_, el) => {
            const relativeLink = $(el).attr("href");
            if (relativeLink && !visitedUrls.has(relativeLink)) {
                const fullLink = relativeLink.startsWith('http') ? relativeLink : `${BASE_URL}${relativeLink}`;
                visitedUrls.add(fullLink);
                listings.push(fullLink);
            }
        });

        console.log(chalk.yellow(`Found ${listings.length} child pages on ${parentUrl}`));

        const scrapedData = (await Promise.all(listings.map(scrapeListing))).filter(Boolean);
        saveToCSV(scrapedData);

        await browser.close();

        // Upload updated CSV to GitHub
        await uploadToGitHub(outputFilePath, GITHUB_CONFIG);

        // Send a success message back to the parent process
        process.send({ success: true });
    } catch (error) {
        console.error(chalk.red(`Error scraping parent page ${parentUrl}: ${error.message}`));
        process.send({ success: false, message: error.message });
    }
};

const parentUrl = process.argv[3];
scrapeChildPages(parentUrl).then(() => {
    console.log(chalk.green("Scraping completed for:", parentUrl));
});
