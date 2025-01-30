const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { randomInt } = require('crypto');
const { setTimeout } = require('timers/promises');

// Random delay function
async function randomDelay() {
    const delay = randomInt(3000, 9500);  // Random delay between 3-9 seconds
    console.log(`Waiting for ${delay}ms...`);
    await setTimeout(delay);
}

// Main scraping function
async function getPageContent() {
    const browser = await puppeteer.launch({
        headless: false,
        slowMo: 50,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox'
        ]
    });

    const page = await browser.newPage();
    const url = 'https://webcaps.sandwell.gov.uk/publicaccess/search.do?action=weeklyList';

    // Set download path
    // Get the path of the current directory and join it with the 'downloads' folder
    const downloadPath = path.join(__dirname, 'downloads'); // Replace with your desired download folder path
    
    // Ensure the downloads folder exists (optional, but good practice)
    const fs = require('fs');
    if (!fs.existsSync(downloadPath)) {
        fs.mkdirSync(downloadPath);
    }

    // Send the download behavior command to the browser context
    //THIS IS NOT WORKING, CAN'T CHANGE THE PATH 
    ///page._client.send is not a function
    // await page._client.send('Page.setDownloadBehavior', {
    //     behavior: 'allow',
    //     downloadPath: downloadPath
    // });

    try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });

        // Handle cookie consent
        try {
            const cookieButtons = await page.$$('#ccc-recommended-settings');
            if (cookieButtons.length > 0) {
                console.log("Clicking cookie consent button...");
                await cookieButtons[0].click();
            }
        } catch (error) {
            console.log('Error handling cookie consent:', error);
        }

        // Select week index from dropdown
        const weekIndex = 1;  // Replace with your required week index
        await page.select('#week', `${weekIndex}`);
        await randomDelay();

        // Submit the form (click the search button)
        const searchButton = await page.$('input[type="submit"]');
        if (searchButton) {
            await searchButton.click();
        }
        await randomDelay();

        // Wait for the 'resultsPerPage' select element to be available
        await page.waitForSelector('#resultsPerPage');

       // Select the option with value '100'
        await page.select('#resultsPerPage', '100');

        // Wait for the 'Go' button to be available and click it
        await page.waitForSelector('input[type="submit"]');  // Assuming the button is a submit button
        await page.click('input[type="submit"]');  // Click the 'Go' button

        // Wait for the results to appear
        await page.waitForSelector('ul li a'); // Wait for anchor tags inside list items

        // Get all the links from the list items
        const links = await page.$$eval('ul li a', (anchors) => {
            return anchors
              .map(anchor => anchor.href)  // Extract the href attribute of each anchor
              .filter(href => href.includes('applicationDetails')); // Filter links containing 'applicationDetails'
          });

        const scrapeDataList = [];

        // Loop through each result and process it
        for (let link of links) {
            console.log("Opening result page...");
        
            // Navigate to the application details page
            await page.goto(link, { waitUntil: 'domcontentloaded' });
            await page.waitForSelector('#simpleDetailsTable');

            // Extract Reference, Address, and Proposal from the table
            const caseDetails = await page.evaluate(() => {
                const details = {};

                // Find the row for "Reference"
                const referenceRow = Array.from(document.querySelectorAll('#simpleDetailsTable tr'))
                    .find(row => row.querySelector('th')?.innerText.trim() === 'Reference');
                if (referenceRow) {
                    details.reference = referenceRow.querySelector('td')?.innerText.trim() || 'No reference found';
                }

                // Find the row for "Address"
                const addressRow = Array.from(document.querySelectorAll('#simpleDetailsTable tr'))
                    .find(row => row.querySelector('th')?.innerText.trim() === 'Address');
                if (addressRow) {
                    details.address = addressRow.querySelector('td')?.innerText.trim() || 'No address found';
                }

                // Find the row for "Proposal"
                const proposalRow = Array.from(document.querySelectorAll('#simpleDetailsTable tr'))
                    .find(row => row.querySelector('th')?.innerText.trim() === 'Proposal');
                if (proposalRow) {
                    details.proposal = proposalRow.querySelector('td')?.innerText.trim() || 'No proposal found';
                }

                return details;
            });

            // Check if the "Documents" tab exists
            const documentsTab = await page.$('#tab_documents');

            if (documentsTab) {
            // Click on the "Documents" tab if it exists
            await documentsTab.click();
                console.log('Documents tab clicked.');
            } else {
                console.log('Documents tab not found. Continuing...');
            // Continue with the next steps if the tab doesn't exist
            }

            await page.waitForSelector('#Documents');

            const documents = await page.evaluate(() => {
                const docs = [];
                const rows = Array.from(document.querySelectorAll('#Documents tr'));

                rows.forEach(row => {
                    const documentType = row.cells[2]?.innerText.trim();
                    const link = row.querySelector('a');
                    if (documentType && documentType !== 'Photo' && link) {
                        const docUrl = link.href;

                        if (docUrl.endsWith('.pdf')) 
                            docs.push({
                                documentType,
                                docUrl
                            });
                    }
                });

                return docs;
            });

            // Loop through each row and select the checkboxes for PDFs
            const rows = await page.$$('#Documents tr');
            for (let row of rows) {
                try {
                    // Get the document type
                    const documentType = await row.$eval('td:nth-child(3)', td => td ? td.innerText.trim() : null);

                    if (!documentType) continue;

                    // Filter for PDF files (excluding photos)
                    if (documentType === 'Application Form' || documentType === 'Other') {
                        const checkbox = await row.$('input[type="checkbox"]');
                        if (checkbox) {
                            await checkbox.click();
                            console.log(`Checkbox clicked for document type: ${documentType}`);
                        }
                    }
                } catch (error) {
                    console.log('Error in row processing:', error);
                }
            }

            // Click "Download Selected Files" button
            const downloadButton = await page.$('#downloadFiles');
            if (downloadButton) {
                await downloadButton.click(); // Trigger download
                console.log('Download button clicked!');
                await randomDelay();
            } else {
                console.log('Download button not found!');
            }

            // Collect the scraped data
            scrapeDataList.push({ caseDetails, documents });
        }

        return scrapeDataList;
    } catch (error) {
        console.log('Error during scraping process:', error);
        return [];
    } finally {
        await browser.close();
    }
}

// Execute the scraping function
(async () => {
    const scrapeResults = await getPageContent();
    // console.log('Scrape Results:', scrapeResults);
})();
