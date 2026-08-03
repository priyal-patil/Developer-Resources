using Contentstack.Core;
using Contentstack.Core.Models;
using Contentstack.Core.Configuration;
using Microsoft.Extensions.Options;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

try
{
    ContentstackClient stack = new ContentstackClient("blt63205a44a56ee96f", "csea3b44e05e5c55667ae5112c", "production");
    TermQuery termQuery = stack.Taxonomies("taxonomy_uid").Terms();
    Console.WriteLine("__SDK_AUTOMATION_RESULT__" + (termQuery == null ? "null" : termQuery.ToString()));
}
catch (Exception e)
{
    Console.WriteLine("__SDK_AUTOMATION_ERROR__" + e.Message);
    Environment.Exit(1);
}
