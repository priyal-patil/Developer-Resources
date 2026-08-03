using Contentstack.Management.Core;
using Contentstack.Management.Core.Models;
using System;
using System.Net;
using System.Collections.Generic;
using System.Threading.Tasks;

try
{

    // Initialize the client
    ContentstackClient client = new ContentstackClient("bltbbd26e7f64dc0eaa");

    try
    {
        // Await the async delete call
        ContentstackResponse contentstackResponse = await client
            .Stack("blt5b0133899f798d0a")
            .PreviewToken("<DELIVERY_TOKEN_UID>")
            .DeleteAsync();
    };
    catch (Exception ex)
    {
        Console.WriteLine($"Error: {ex.Message}");
    };
    Console.WriteLine("__SDK_AUTOMATION_RESULT__" + (client == null ? "null" : client.ToString()));
}
catch (Exception e)
{
    Console.WriteLine("__SDK_AUTOMATION_ERROR__" + e.Message);
    System.Environment.Exit(1);
}
