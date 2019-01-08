import fs = require('fs');
import path = require('path');
import os = require('os');
import tl = require('vsts-task-lib/task');
import tr = require('vsts-task-lib/toolrunner');
import { AzureRMEndpoint } from 'azure-arm-rest/azure-arm-endpoint';
import { AzureEndpoint } from 'azure-arm-rest/azureModels';
var uuidV4 = require('uuid/v4');

async function run() {
    try {
        tl.setResourcePath(path.join(__dirname, 'task.json'));

        // Get inputs.
        let input_errorActionPreference: string = tl.getInput('errorActionPreference', false) || 'Stop';
        switch (input_errorActionPreference.toUpperCase()) {
            case 'STOP':
            case 'CONTINUE':
            case 'SILENTLYCONTINUE':
                break;
            default:
                throw new Error(tl.loc('JS_InvalidErrorActionPreference', input_errorActionPreference));
        }

        let scriptType: string = tl.getInput('ScriptType', /*required*/true);
        let scriptPath = tl.getPathInput('ScriptPath', false);
        let scriptInline: string = tl.getInput('Inline', false);
        let scriptArguments: string = tl.getInput('ScriptArguments', false);
        let _vsts_input_errorActionPreference: string = tl.getInput('errorActionPreference', false) || 'Stop';
        let _vsts_input_failOnStandardError = tl.getBoolInput('FailOnStandardError', false);
        let targetAzurePs: string = tl.getInput('TargetAzurePs', false);
        let customTargetAzurePs: string = tl.getInput('CustomTargetAzurePs', false);
        let serviceName = tl.getInput('ConnectedServiceNameARM',/*required*/true);
        let endpointt= await new AzureRMEndpoint(serviceName).getEndpoint();

        // string constants
        let otherVersion = "OtherVersion"
        let latestVersion = "LatestVersion"

        if (targetAzurePs == otherVersion) {
            if (customTargetAzurePs != "") {
                targetAzurePs = customTargetAzurePs;
            }
            else {
                targetAzurePs = ""
            }
        }

        var endpoint = JSON.stringify(endpointt);

        if (scriptType.toUpperCase() == 'FILEPATH') {
            if (!tl.stats(scriptPath).isFile() || !scriptPath.toUpperCase().match(/\.PS1$/)) {
                throw new Error(tl.loc('JS_InvalidFilePath', scriptPath));
            }
        }

        // Generate the script contents.
        console.log(tl.loc('GeneratingScript'));
        let contents: string[] = [];
        let filePath3 = path.join(path.resolve(__dirname), 'InitializeAz.ps1');
        contents.push(`${filePath3} -targetAzurePs  ${targetAzurePs} -serviceName ${serviceName} -endpoint '${endpoint}'`);
        contents.push(`$ErrorActionPreference = '${input_errorActionPreference}'`); 

        if (scriptType.toUpperCase() == 'FILEPATH') {
            contents.push(`. '${scriptPath.replace("'", "''")}' ${scriptArguments}`.trim());
            console.log(tl.loc('JS_FormattedCommand', contents[contents.length - 1]));
        }
        else {
            contents.push(scriptInline);
        }

        // Write the script to disk.
        tl.assertAgent('2.115.0');
        let tempDirectory = tl.getVariable('agent.tempDirectory');
        tl.checkPath(tempDirectory, `${tempDirectory} (agent.tempDirectory)`);
        let filePath = path.join(tempDirectory, uuidV4() + '.ps1');

        await fs.writeFile(
            filePath,
            '\ufeff' + contents.join(os.EOL), // Prepend the Unicode BOM character.
            { encoding: 'utf8' });           // Since UTF8 encoding is specified, node will
                                            // encode the BOM into its UTF8 binary sequence.

        // Run the script.
        //
        // Note, prefer "pwsh" over "powershell". At some point we can remove support for "powershell".
        //
        // Note, use "-Command" instead of "-File" to match the Windows implementation. Refer to
        // comment on Windows implementation for an explanation why "-Command" is preferred.
        let powershell = tl.tool(tl.which('pwsh') || tl.which('powershell') || tl.which('pwsh', true))
            .arg('-NoLogo')
            .arg('-NoProfile')
            .arg('-NonInteractive')
            .arg('-ExecutionPolicy')
            .arg('Unrestricted')
            .arg('-Command')
            .arg(`. '${filePath.replace("'", "''")}'`);

        let options = <tr.IExecOptions>{
            errStream: process.stdout, // Direct all output to STDOUT, otherwise the output may appear out
            outStream: process.stdout, // of order since Node buffers it's own STDOUT but not STDERR.
            ignoreReturnCode: true
        };


        // Run bash.
        let exitCode: number = await powershell.exec(options);
    }
    catch (err) {
        tl.setResult(tl.TaskResult.Failed, err.message || 'run() failed');
    }
}

run();