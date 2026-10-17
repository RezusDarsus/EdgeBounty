/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/edgebounty_marketplace.json`.
 */
export type EdgebountyMarketplace = {
  "address": "6L6441Vus4rUdQXLiGfFtXUtRWbjqg3Lk1AfCjj6x3E",
  "metadata": {
    "name": "edgebountyMarketplace",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "EdgeBounty Solana marketplace program"
  },
  "instructions": [
    {
      "name": "acceptAdmin",
      "discriminator": [
        112,
        42,
        45,
        90,
        116,
        181,
        13,
        170
      ],
      "accounts": [
        {
          "name": "newAdmin",
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "acceptBounty",
      "discriminator": [
        165,
        37,
        99,
        130,
        123,
        244,
        67,
        35
      ],
      "accounts": [
        {
          "name": "seller",
          "signer": true
        },
        {
          "name": "order",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "acceptDeliverable",
      "discriminator": [
        225,
        151,
        217,
        255,
        133,
        179,
        243,
        38
      ],
      "accounts": [
        {
          "name": "buyer",
          "signer": true,
          "relations": [
            "order"
          ]
        },
        {
          "name": "order",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "acceptVerificationJob",
      "discriminator": [
        120,
        3,
        99,
        222,
        117,
        230,
        135,
        132
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "provider",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  118,
                  105,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "job",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "addDisputeEvidence",
      "discriminator": [
        154,
        54,
        114,
        31,
        211,
        6,
        111,
        187
      ],
      "accounts": [
        {
          "name": "party",
          "signer": true
        },
        {
          "name": "order"
        },
        {
          "name": "dispute",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "evidenceHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "cancelOrder",
      "discriminator": [
        95,
        129,
        237,
        240,
        8,
        49,
        223,
        132
      ],
      "accounts": [
        {
          "name": "buyer",
          "writable": true,
          "signer": true,
          "relations": [
            "order"
          ]
        },
        {
          "name": "order",
          "writable": true
        },
        {
          "name": "vault",
          "docs": [
            "Required only when the order is funded."
          ],
          "writable": true,
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "order"
              }
            ]
          }
        },
        {
          "name": "mint",
          "optional": true
        },
        {
          "name": "buyerToken",
          "writable": true,
          "optional": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "closeFailureBounty",
      "discriminator": [
        110,
        124,
        225,
        148,
        233,
        158,
        188,
        3
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true,
          "relations": [
            "bounty"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "bounty",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "bounty"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "creatorToken",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "createBounty",
      "discriminator": [
        122,
        90,
        14,
        143,
        8,
        125,
        200,
        2
      ],
      "accounts": [
        {
          "name": "buyer",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "order",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "buyer"
              },
              {
                "kind": "arg",
                "path": "orderId"
              }
            ]
          }
        },
        {
          "name": "verifierProvider",
          "optional": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "orderId",
          "type": "u64"
        },
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "bountyParams"
            }
          }
        }
      ]
    },
    {
      "name": "createFailureBounty",
      "discriminator": [
        158,
        123,
        199,
        3,
        189,
        115,
        32,
        69
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "bounty",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  98,
                  111,
                  117,
                  110,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "creator"
              },
              {
                "kind": "arg",
                "path": "bountyId"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "bounty"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "creatorToken",
          "writable": true
        },
        {
          "name": "verifierProvider"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "bountyId",
          "type": "u64"
        },
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "failureBountyParams"
            }
          }
        }
      ]
    },
    {
      "name": "createListing",
      "discriminator": [
        18,
        168,
        45,
        24,
        191,
        31,
        117,
        54
      ],
      "accounts": [
        {
          "name": "seller",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "listing",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  115,
                  116,
                  105,
                  110,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "seller"
              },
              {
                "kind": "arg",
                "path": "listingId"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "listingId",
          "type": "u64"
        },
        {
          "name": "kind",
          "type": {
            "defined": {
              "name": "assetKind"
            }
          }
        },
        {
          "name": "terms",
          "type": {
            "defined": {
              "name": "listingTerms"
            }
          }
        }
      ]
    },
    {
      "name": "createOrder",
      "discriminator": [
        141,
        54,
        37,
        207,
        237,
        210,
        250,
        215
      ],
      "accounts": [
        {
          "name": "buyer",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "listing",
          "writable": true
        },
        {
          "name": "order",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "buyer"
              },
              {
                "kind": "arg",
                "path": "orderId"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "order"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "buyerToken",
          "writable": true
        },
        {
          "name": "verifierProvider",
          "optional": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "orderId",
          "type": "u64"
        },
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "purchaseParams"
            }
          }
        }
      ]
    },
    {
      "name": "createVerificationJob",
      "discriminator": [
        253,
        7,
        68,
        12,
        87,
        172,
        204,
        171
      ],
      "accounts": [
        {
          "name": "requester",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "job",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  106,
                  111,
                  98
                ]
              },
              {
                "kind": "account",
                "path": "requester"
              },
              {
                "kind": "arg",
                "path": "jobId"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  106,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "job"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "requesterToken",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "jobId",
          "type": "u64"
        },
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "jobParams"
            }
          }
        }
      ]
    },
    {
      "name": "disputeVerificationJob",
      "discriminator": [
        122,
        27,
        106,
        183,
        64,
        117,
        99,
        179
      ],
      "accounts": [
        {
          "name": "requester",
          "writable": true,
          "signer": true,
          "relations": [
            "job"
          ]
        },
        {
          "name": "job",
          "writable": true
        },
        {
          "name": "dispute",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "reasonHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "fundBounty",
      "discriminator": [
        36,
        148,
        139,
        239,
        172,
        37,
        58,
        255
      ],
      "accounts": [
        {
          "name": "buyer",
          "writable": true,
          "signer": true,
          "relations": [
            "order"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "order",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "order"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "buyerToken",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initializePlatform",
      "discriminator": [
        119,
        201,
        101,
        45,
        75,
        122,
        89,
        3
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "program",
          "address": "6L6441Vus4rUdQXLiGfFtXUtRWbjqg3Lk1AfCjj6x3E"
        },
        {
          "name": "programData"
        },
        {
          "name": "paymentMint"
        },
        {
          "name": "treasury"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "platformParams"
            }
          }
        }
      ]
    },
    {
      "name": "moderateListing",
      "discriminator": [
        25,
        14,
        97,
        227,
        22,
        0,
        19,
        168
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "listing",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "moderated",
          "type": "bool"
        }
      ]
    },
    {
      "name": "openDispute",
      "discriminator": [
        137,
        25,
        99,
        119,
        23,
        223,
        161,
        42
      ],
      "accounts": [
        {
          "name": "opener",
          "writable": true,
          "signer": true
        },
        {
          "name": "order",
          "writable": true
        },
        {
          "name": "dispute",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "reasonHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "payService",
      "discriminator": [
        181,
        29,
        236,
        80,
        246,
        226,
        34,
        174
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "receipt",
          "docs": [
            "One receipt per invoice reference: an invoice can never be paid (or counted) twice."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  99,
                  101,
                  105,
                  112,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "reference"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "payerToken",
          "writable": true
        },
        {
          "name": "treasury",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "reference",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "kind",
          "type": "u8"
        },
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "proposeAdmin",
      "discriminator": [
        121,
        214,
        199,
        212,
        87,
        39,
        117,
        234
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "newAdmin",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "refundOrder",
      "discriminator": [
        164,
        168,
        47,
        144,
        154,
        1,
        241,
        255
      ],
      "accounts": [
        {
          "name": "buyer",
          "writable": true,
          "signer": true,
          "relations": [
            "order"
          ]
        },
        {
          "name": "order",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "order"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "buyerToken",
          "writable": true
        },
        {
          "name": "verifierToken",
          "writable": true,
          "optional": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "refundVerificationJob",
      "discriminator": [
        178,
        167,
        244,
        219,
        221,
        242,
        234,
        127
      ],
      "accounts": [
        {
          "name": "requester",
          "writable": true,
          "signer": true,
          "relations": [
            "job"
          ]
        },
        {
          "name": "job",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  106,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "job"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "requesterToken",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "registerProvider",
      "discriminator": [
        254,
        209,
        54,
        184,
        46,
        197,
        109,
        78
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "provider",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  118,
                  105,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "metadataHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "requestedCapabilities",
          "type": "u32"
        }
      ]
    },
    {
      "name": "rejectDeliverable",
      "discriminator": [
        79,
        39,
        42,
        174,
        74,
        211,
        205,
        193
      ],
      "accounts": [
        {
          "name": "buyer",
          "signer": true,
          "relations": [
            "order"
          ]
        },
        {
          "name": "order",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "resolveDispute",
      "discriminator": [
        231,
        6,
        202,
        6,
        96,
        103,
        12,
        230
      ],
      "accounts": [
        {
          "name": "disputeAuthority",
          "docs": [
            "The platform dispute authority, or the order's agreed independent arbitrator."
          ],
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "order",
          "writable": true
        },
        {
          "name": "dispute",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "resolution",
          "type": {
            "defined": {
              "name": "disputeResolution"
            }
          }
        },
        {
          "name": "sellerBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "resolveVerificationDispute",
      "discriminator": [
        54,
        174,
        241,
        180,
        142,
        92,
        79,
        159
      ],
      "accounts": [
        {
          "name": "disputeAuthority",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "job",
          "writable": true
        },
        {
          "name": "dispute",
          "writable": true
        },
        {
          "name": "provider",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  118,
                  105,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "job.provider",
                "account": "verificationJob"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "providerBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "reviewProvider",
      "discriminator": [
        29,
        72,
        164,
        99,
        141,
        47,
        186,
        139
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "provider",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  118,
                  105,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "provider.authority",
                "account": "provider"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "approved",
          "type": "bool"
        },
        {
          "name": "capabilities",
          "type": "u32"
        }
      ]
    },
    {
      "name": "revokeAttestation",
      "discriminator": [
        12,
        156,
        103,
        161,
        194,
        246,
        211,
        179
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "attestation",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "setListingActive",
      "discriminator": [
        197,
        68,
        14,
        217,
        62,
        57,
        28,
        145
      ],
      "accounts": [
        {
          "name": "seller",
          "signer": true,
          "relations": [
            "listing"
          ]
        },
        {
          "name": "listing",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  115,
                  116,
                  105,
                  110,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "seller"
              },
              {
                "kind": "account",
                "path": "listing.listingId",
                "account": "listing"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "active",
          "type": "bool"
        }
      ]
    },
    {
      "name": "setPaused",
      "discriminator": [
        91,
        60,
        125,
        192,
        176,
        225,
        166,
        218
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    },
    {
      "name": "setTreasury",
      "discriminator": [
        57,
        97,
        196,
        95,
        195,
        206,
        106,
        136
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "treasury"
        }
      ],
      "args": []
    },
    {
      "name": "settleOrder",
      "discriminator": [
        80,
        74,
        204,
        34,
        12,
        183,
        66,
        66
      ],
      "accounts": [
        {
          "name": "payer",
          "docs": [
            "Anyone may crank settlement (pays rent for receipts)."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "order",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "order"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "sellerToken",
          "writable": true
        },
        {
          "name": "buyerToken",
          "writable": true
        },
        {
          "name": "treasury",
          "writable": true
        },
        {
          "name": "verifierToken",
          "writable": true,
          "optional": true
        },
        {
          "name": "buyer",
          "writable": true
        },
        {
          "name": "licenseReceipt",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  99,
                  101,
                  110,
                  115,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "order"
              }
            ]
          }
        },
        {
          "name": "sellerReputation",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  112,
                  117,
                  116,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "order.seller",
                "account": "order"
              }
            ]
          }
        },
        {
          "name": "buyerReputation",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  112,
                  117,
                  116,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "order.buyer",
                "account": "order"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "settleVerificationJob",
      "discriminator": [
        52,
        133,
        80,
        191,
        92,
        166,
        130,
        193
      ],
      "accounts": [
        {
          "name": "caller",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "job",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  106,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "job"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "providerToken",
          "writable": true
        },
        {
          "name": "requesterToken",
          "writable": true
        },
        {
          "name": "treasury",
          "writable": true
        },
        {
          "name": "requester",
          "writable": true
        },
        {
          "name": "provider",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  118,
                  105,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "job.provider",
                "account": "verificationJob"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "submitDeliverable",
      "discriminator": [
        38,
        137,
        64,
        44,
        237,
        11,
        125,
        101
      ],
      "accounts": [
        {
          "name": "seller",
          "writable": true,
          "signer": true,
          "relations": [
            "order"
          ]
        },
        {
          "name": "order",
          "writable": true
        },
        {
          "name": "submission",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "commitment",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "version",
          "type": "u32"
        }
      ]
    },
    {
      "name": "submitFailureExample",
      "discriminator": [
        97,
        174,
        159,
        234,
        24,
        205,
        130,
        229
      ],
      "accounts": [
        {
          "name": "contributor",
          "writable": true,
          "signer": true
        },
        {
          "name": "bounty",
          "writable": true
        },
        {
          "name": "example",
          "docs": [
            "Seeded by the content commitment: identical submissions collide and fail."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  120,
                  97,
                  109,
                  112,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "bounty"
              },
              {
                "kind": "arg",
                "path": "commitment"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "commitment",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "submitOrderVerification",
      "discriminator": [
        24,
        7,
        51,
        54,
        82,
        134,
        66,
        117
      ],
      "accounts": [
        {
          "name": "verifier",
          "writable": true,
          "signer": true,
          "relations": [
            "order"
          ]
        },
        {
          "name": "order",
          "writable": true
        },
        {
          "name": "provider",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  118,
                  105,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "verifier"
              }
            ]
          }
        },
        {
          "name": "attestation",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "verdict",
          "type": {
            "defined": {
              "name": "verdictParams"
            }
          }
        }
      ]
    },
    {
      "name": "submitVerificationJobResult",
      "discriminator": [
        28,
        129,
        17,
        242,
        143,
        245,
        62,
        200
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "provider",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  118,
                  105,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "job",
          "writable": true
        },
        {
          "name": "attestation",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "result",
          "type": {
            "defined": {
              "name": "jobResultParams"
            }
          }
        }
      ]
    },
    {
      "name": "updateConfig",
      "discriminator": [
        29,
        158,
        252,
        191,
        10,
        83,
        219,
        99
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "platformParams"
            }
          }
        }
      ]
    },
    {
      "name": "updateListingVersion",
      "discriminator": [
        82,
        183,
        222,
        39,
        124,
        237,
        9,
        7
      ],
      "accounts": [
        {
          "name": "seller",
          "signer": true,
          "relations": [
            "listing"
          ]
        },
        {
          "name": "listing",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  115,
                  116,
                  105,
                  110,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "seller"
              },
              {
                "kind": "account",
                "path": "listing.listingId",
                "account": "listing"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "terms",
          "type": {
            "defined": {
              "name": "listingTerms"
            }
          }
        }
      ]
    },
    {
      "name": "updateProvider",
      "discriminator": [
        52,
        208,
        141,
        191,
        164,
        54,
        108,
        150
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "provider"
          ]
        },
        {
          "name": "provider",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  118,
                  105,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "metadataHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "requestedCapabilities",
          "type": "u32"
        }
      ]
    },
    {
      "name": "verifyFailureExample",
      "discriminator": [
        141,
        226,
        228,
        252,
        15,
        237,
        92,
        82
      ],
      "accounts": [
        {
          "name": "verifier",
          "writable": true,
          "signer": true,
          "relations": [
            "bounty"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "bounty",
          "writable": true,
          "relations": [
            "example"
          ]
        },
        {
          "name": "example",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "bounty"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "contributorToken",
          "writable": true
        },
        {
          "name": "verifierToken",
          "writable": true
        },
        {
          "name": "treasury",
          "writable": true
        },
        {
          "name": "provider",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  118,
                  105,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "verifier"
              }
            ]
          }
        },
        {
          "name": "attestation",
          "writable": true
        },
        {
          "name": "contributorReputation",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  112,
                  117,
                  116,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "example.contributor",
                "account": "failureExample"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "passed",
          "type": "bool"
        },
        {
          "name": "resultHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "attestation",
      "discriminator": [
        152,
        125,
        183,
        86,
        36,
        146,
        121,
        73
      ]
    },
    {
      "name": "dispute",
      "discriminator": [
        36,
        49,
        241,
        67,
        40,
        36,
        241,
        74
      ]
    },
    {
      "name": "failureBounty",
      "discriminator": [
        77,
        205,
        39,
        186,
        217,
        143,
        45,
        192
      ]
    },
    {
      "name": "failureExample",
      "discriminator": [
        68,
        81,
        194,
        10,
        132,
        55,
        111,
        28
      ]
    },
    {
      "name": "licenseReceipt",
      "discriminator": [
        190,
        248,
        58,
        152,
        158,
        41,
        96,
        139
      ]
    },
    {
      "name": "listing",
      "discriminator": [
        218,
        32,
        50,
        73,
        43,
        134,
        26,
        58
      ]
    },
    {
      "name": "order",
      "discriminator": [
        134,
        173,
        223,
        185,
        77,
        86,
        28,
        51
      ]
    },
    {
      "name": "platformConfig",
      "discriminator": [
        160,
        78,
        128,
        0,
        248,
        83,
        230,
        160
      ]
    },
    {
      "name": "provider",
      "discriminator": [
        164,
        180,
        71,
        17,
        75,
        216,
        80,
        195
      ]
    },
    {
      "name": "reputation",
      "discriminator": [
        55,
        148,
        90,
        71,
        68,
        183,
        193,
        28
      ]
    },
    {
      "name": "serviceReceipt",
      "discriminator": [
        153,
        94,
        22,
        87,
        76,
        254,
        54,
        233
      ]
    },
    {
      "name": "submission",
      "discriminator": [
        58,
        194,
        159,
        158,
        75,
        102,
        178,
        197
      ]
    },
    {
      "name": "verificationJob",
      "discriminator": [
        223,
        132,
        167,
        162,
        78,
        8,
        58,
        13
      ]
    }
  ],
  "events": [
    {
      "name": "attestationIssued",
      "discriminator": [
        173,
        237,
        90,
        123,
        155,
        224,
        231,
        242
      ]
    },
    {
      "name": "failureExampleEvaluated",
      "discriminator": [
        154,
        213,
        31,
        23,
        220,
        201,
        13,
        221
      ]
    },
    {
      "name": "jobStateChanged",
      "discriminator": [
        107,
        94,
        145,
        221,
        172,
        199,
        255,
        31
      ]
    },
    {
      "name": "orderPaidOut",
      "discriminator": [
        79,
        230,
        115,
        173,
        102,
        121,
        159,
        189
      ]
    },
    {
      "name": "orderStateChanged",
      "discriminator": [
        145,
        183,
        104,
        91,
        34,
        139,
        177,
        240
      ]
    },
    {
      "name": "servicePaid",
      "discriminator": [
        216,
        238,
        208,
        194,
        12,
        54,
        84,
        226
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "unauthorized",
      "msg": "Signer is not authorized for this action"
    },
    {
      "code": 6001,
      "name": "paused",
      "msg": "Platform is paused for new commitments"
    },
    {
      "code": 6002,
      "name": "feeTooHigh",
      "msg": "Fee exceeds the hard maximum"
    },
    {
      "code": 6003,
      "name": "invalidWindow",
      "msg": "Window duration out of range"
    },
    {
      "code": 6004,
      "name": "zeroAmount",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6005,
      "name": "overflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6006,
      "name": "invalidState",
      "msg": "Invalid state transition for this order"
    },
    {
      "code": 6007,
      "name": "deadlinePassed",
      "msg": "Deadline has passed"
    },
    {
      "code": 6008,
      "name": "deadlineNotReached",
      "msg": "Deadline has not passed yet"
    },
    {
      "code": 6009,
      "name": "invalidDeadline",
      "msg": "Deadline must be in the future"
    },
    {
      "code": 6010,
      "name": "conflictOfInterest",
      "msg": "Buyer, seller and verifier must be distinct wallets"
    },
    {
      "code": 6011,
      "name": "verifierNotApproved",
      "msg": "Verifier is not an approved provider"
    },
    {
      "code": 6012,
      "name": "missingCapability",
      "msg": "Provider lacks the required capability"
    },
    {
      "code": 6013,
      "name": "verifierMismatch",
      "msg": "Verifier account does not match the order"
    },
    {
      "code": 6014,
      "name": "listingUnavailable",
      "msg": "Listing is not available for purchase"
    },
    {
      "code": 6015,
      "name": "listingChanged",
      "msg": "Listing price or version changed"
    },
    {
      "code": 6016,
      "name": "noCorrectionsLeft",
      "msg": "No corrections remaining"
    },
    {
      "code": 6017,
      "name": "rejectionNotAllowed",
      "msg": "Verification has not failed; rejection requires a failed verdict"
    },
    {
      "code": 6018,
      "name": "invalidBps",
      "msg": "Invalid basis points value"
    },
    {
      "code": 6019,
      "name": "tokenOwnerMismatch",
      "msg": "Token account owner mismatch"
    },
    {
      "code": 6020,
      "name": "treasuryMismatch",
      "msg": "Treasury account mismatch"
    },
    {
      "code": 6021,
      "name": "verifierTokenRequired",
      "msg": "Verifier token account required"
    },
    {
      "code": 6022,
      "name": "tooManyCorrections",
      "msg": "Too many corrections requested"
    },
    {
      "code": 6023,
      "name": "bountyFull",
      "msg": "Bounty is full"
    },
    {
      "code": 6024,
      "name": "bountyClosed",
      "msg": "Bounty is not open"
    },
    {
      "code": 6025,
      "name": "evaluationBudgetExhausted",
      "msg": "Evaluation budget exhausted"
    },
    {
      "code": 6026,
      "name": "exampleAlreadyEvaluated",
      "msg": "Example already evaluated"
    },
    {
      "code": 6027,
      "name": "cannotCloseYet",
      "msg": "Bounty cannot be closed yet"
    },
    {
      "code": 6028,
      "name": "listingModerated",
      "msg": "Listing has been moderated and cannot be reactivated"
    },
    {
      "code": 6029,
      "name": "noPendingAdmin",
      "msg": "No pending admin transfer"
    },
    {
      "code": 6030,
      "name": "invalidResolution",
      "msg": "Invalid resolution"
    },
    {
      "code": 6031,
      "name": "alreadyRevoked",
      "msg": "Attestation already revoked"
    },
    {
      "code": 6032,
      "name": "notUpgradeAuthority",
      "msg": "Only the program upgrade authority can initialize the platform"
    }
  ],
  "types": [
    {
      "name": "assetKind",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "dataset"
          },
          {
            "name": "model"
          },
          {
            "name": "code"
          },
          {
            "name": "other"
          }
        ]
      }
    },
    {
      "name": "attestation",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "subject",
            "docs": [
              "Order, verification job, or failure example this attestation is about."
            ],
            "type": "pubkey"
          },
          {
            "name": "verifier",
            "type": "pubkey"
          },
          {
            "name": "assetCommitment",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "assetVersion",
            "type": "u32"
          },
          {
            "name": "specHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "benchmarkVersion",
            "type": "u32"
          },
          {
            "name": "resultHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "passed",
            "type": "bool"
          },
          {
            "name": "issuedAt",
            "type": "i64"
          },
          {
            "name": "expiresAt",
            "docs": [
              "0 = no expiry."
            ],
            "type": "i64"
          },
          {
            "name": "revoked",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "attestationIssued",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "attestation",
            "type": "pubkey"
          },
          {
            "name": "subject",
            "type": "pubkey"
          },
          {
            "name": "verifier",
            "type": "pubkey"
          },
          {
            "name": "passed",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "bountyParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "verifier",
            "type": "pubkey"
          },
          {
            "name": "verifierFee",
            "type": "u64"
          },
          {
            "name": "verifierCapability",
            "type": "u32"
          },
          {
            "name": "termsHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "criteriaHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "licenseHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "deadline",
            "type": "i64"
          },
          {
            "name": "maxCorrections",
            "type": "u8"
          },
          {
            "name": "designatedSeller",
            "docs": [
              "Default pubkey = open to any seller."
            ],
            "type": "pubkey"
          },
          {
            "name": "arbitrator",
            "docs": [
              "Default pubkey = platform dispute authority only."
            ],
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "dispute",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "subject",
            "type": "pubkey"
          },
          {
            "name": "openedBy",
            "type": "pubkey"
          },
          {
            "name": "reasonHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "buyerEvidence",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "sellerEvidence",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "evidenceCount",
            "type": "u16"
          },
          {
            "name": "resolution",
            "type": {
              "defined": {
                "name": "disputeResolution"
              }
            }
          },
          {
            "name": "sellerBps",
            "type": "u16"
          },
          {
            "name": "openedAt",
            "type": "i64"
          },
          {
            "name": "resolvedAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "disputeResolution",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "pending"
          },
          {
            "name": "correction"
          },
          {
            "name": "split"
          }
        ]
      }
    },
    {
      "name": "exampleState",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "pending"
          },
          {
            "name": "accepted"
          },
          {
            "name": "rejected"
          }
        ]
      }
    },
    {
      "name": "failureBounty",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "bountyId",
            "type": "u64"
          },
          {
            "name": "verifier",
            "type": "pubkey"
          },
          {
            "name": "modelCommitment",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "specHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "termsHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "rewardPerExample",
            "type": "u64"
          },
          {
            "name": "verifierFee",
            "type": "u64"
          },
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "maxExamples",
            "type": "u16"
          },
          {
            "name": "maxEvaluations",
            "type": "u16"
          },
          {
            "name": "accepted",
            "type": "u16"
          },
          {
            "name": "evaluations",
            "type": "u16"
          },
          {
            "name": "pending",
            "type": "u16"
          },
          {
            "name": "expiresAt",
            "type": "i64"
          },
          {
            "name": "open",
            "type": "bool"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "failureBountyParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "verifier",
            "type": "pubkey"
          },
          {
            "name": "modelCommitment",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "specHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "termsHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "rewardPerExample",
            "type": "u64"
          },
          {
            "name": "verifierFee",
            "type": "u64"
          },
          {
            "name": "maxExamples",
            "type": "u16"
          },
          {
            "name": "maxEvaluations",
            "type": "u16"
          },
          {
            "name": "expiresAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "failureExample",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bounty",
            "type": "pubkey"
          },
          {
            "name": "contributor",
            "type": "pubkey"
          },
          {
            "name": "commitment",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "state",
            "type": {
              "defined": {
                "name": "exampleState"
              }
            }
          },
          {
            "name": "resultHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "submittedAt",
            "type": "i64"
          },
          {
            "name": "evaluatedAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "failureExampleEvaluated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bounty",
            "type": "pubkey"
          },
          {
            "name": "example",
            "type": "pubkey"
          },
          {
            "name": "accepted",
            "type": "bool"
          },
          {
            "name": "rewardPaid",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "jobParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "provider",
            "docs": [
              "Default pubkey = open to any approved provider with `required_capability`."
            ],
            "type": "pubkey"
          },
          {
            "name": "requiredCapability",
            "type": "u32"
          },
          {
            "name": "assetCommitment",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "specHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "price",
            "type": "u64"
          },
          {
            "name": "deadline",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "jobResultParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "resultHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "passed",
            "type": "bool"
          },
          {
            "name": "assetVersion",
            "type": "u32"
          },
          {
            "name": "benchmarkVersion",
            "type": "u32"
          },
          {
            "name": "expiresAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "jobState",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "open"
          },
          {
            "name": "accepted"
          },
          {
            "name": "resultSubmitted"
          },
          {
            "name": "disputed"
          },
          {
            "name": "resolved"
          },
          {
            "name": "completed"
          },
          {
            "name": "refunded"
          }
        ]
      }
    },
    {
      "name": "jobStateChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "job",
            "type": "pubkey"
          },
          {
            "name": "state",
            "type": {
              "defined": {
                "name": "jobState"
              }
            }
          },
          {
            "name": "at",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "licenseReceipt",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "order",
            "type": "pubkey"
          },
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "seller",
            "type": "pubkey"
          },
          {
            "name": "listing",
            "type": "pubkey"
          },
          {
            "name": "assetCommitment",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "assetVersion",
            "type": "u32"
          },
          {
            "name": "licenseHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "termsHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "granted",
            "docs": [
              "False when the order settled with a full refund (no entitlement)."
            ],
            "type": "bool"
          },
          {
            "name": "issuedAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "listing",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "seller",
            "type": "pubkey"
          },
          {
            "name": "listingId",
            "type": "u64"
          },
          {
            "name": "kind",
            "type": {
              "defined": {
                "name": "assetKind"
              }
            }
          },
          {
            "name": "version",
            "type": "u32"
          },
          {
            "name": "assetCommitment",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "termsHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "licenseHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "price",
            "type": "u64"
          },
          {
            "name": "active",
            "type": "bool"
          },
          {
            "name": "moderated",
            "type": "bool"
          },
          {
            "name": "sales",
            "type": "u64"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "updatedAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "listingTerms",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "assetCommitment",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "termsHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "licenseHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "price",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "order",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "seller",
            "docs": [
              "Default pubkey until a seller accepts a bounty."
            ],
            "type": "pubkey"
          },
          {
            "name": "verifier",
            "docs": [
              "Default pubkey when no independent verifier is required."
            ],
            "type": "pubkey"
          },
          {
            "name": "listing",
            "docs": [
              "Default pubkey for custom bounties."
            ],
            "type": "pubkey"
          },
          {
            "name": "orderId",
            "type": "u64"
          },
          {
            "name": "kind",
            "type": {
              "defined": {
                "name": "orderKind"
              }
            }
          },
          {
            "name": "state",
            "type": {
              "defined": {
                "name": "orderState"
              }
            }
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "verifierFee",
            "type": "u64"
          },
          {
            "name": "feeBps",
            "docs": [
              "Platform fee locked at funding time."
            ],
            "type": "u16"
          },
          {
            "name": "termsHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "criteriaHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "licenseHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "deadline",
            "type": "i64"
          },
          {
            "name": "reviewWindowSecs",
            "type": "i64"
          },
          {
            "name": "correctionWindowSecs",
            "type": "i64"
          },
          {
            "name": "reviewDeadline",
            "type": "i64"
          },
          {
            "name": "correctionDeadline",
            "type": "i64"
          },
          {
            "name": "submittedAt",
            "type": "i64"
          },
          {
            "name": "maxCorrections",
            "type": "u8"
          },
          {
            "name": "submissionCount",
            "type": "u8"
          },
          {
            "name": "currentCommitment",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "currentVersion",
            "type": "u32"
          },
          {
            "name": "verificationsDone",
            "type": "u8"
          },
          {
            "name": "verdictCurrent",
            "type": "bool"
          },
          {
            "name": "verdictPassed",
            "type": "bool"
          },
          {
            "name": "disputed",
            "type": "bool"
          },
          {
            "name": "disputeCount",
            "type": "u8"
          },
          {
            "name": "designatedSeller",
            "docs": [
              "If set, only this wallet may accept the bounty (milestone continuations, direct hires)."
            ],
            "type": "pubkey"
          },
          {
            "name": "arbitrator",
            "docs": [
              "If set, this agreed independent arbitrator may resolve disputes on this order",
              "(in addition to the platform dispute authority)."
            ],
            "type": "pubkey"
          },
          {
            "name": "sellerBps",
            "type": "u16"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "fundedAt",
            "type": "i64"
          },
          {
            "name": "closedAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "orderKind",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "purchase"
          },
          {
            "name": "bounty"
          }
        ]
      }
    },
    {
      "name": "orderPaidOut",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "order",
            "type": "pubkey"
          },
          {
            "name": "sellerNet",
            "type": "u64"
          },
          {
            "name": "platformFee",
            "type": "u64"
          },
          {
            "name": "verifierPaid",
            "type": "u64"
          },
          {
            "name": "buyerRefund",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "orderState",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "created"
          },
          {
            "name": "funded"
          },
          {
            "name": "assigned"
          },
          {
            "name": "submitted"
          },
          {
            "name": "underReview"
          },
          {
            "name": "approved"
          },
          {
            "name": "disputed"
          },
          {
            "name": "correctionRequired"
          },
          {
            "name": "settled"
          },
          {
            "name": "refunded"
          },
          {
            "name": "cancelled"
          }
        ]
      }
    },
    {
      "name": "orderStateChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "order",
            "type": "pubkey"
          },
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "seller",
            "type": "pubkey"
          },
          {
            "name": "state",
            "type": {
              "defined": {
                "name": "orderState"
              }
            }
          },
          {
            "name": "at",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "platformConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "pendingAdmin",
            "docs": [
              "Two-step admin transfer target (default = none)."
            ],
            "type": "pubkey"
          },
          {
            "name": "disputeAuthority",
            "type": "pubkey"
          },
          {
            "name": "paymentMint",
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "reviewWindowSecs",
            "type": "i64"
          },
          {
            "name": "correctionWindowSecs",
            "type": "i64"
          },
          {
            "name": "failureBountyGraceSecs",
            "type": "i64"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "platformParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "reviewWindowSecs",
            "type": "i64"
          },
          {
            "name": "correctionWindowSecs",
            "type": "i64"
          },
          {
            "name": "failureBountyGraceSecs",
            "type": "i64"
          },
          {
            "name": "disputeAuthority",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "provider",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "approved",
            "type": "bool"
          },
          {
            "name": "capabilities",
            "docs": [
              "Capabilities granted by the admin."
            ],
            "type": "u32"
          },
          {
            "name": "requestedCapabilities",
            "docs": [
              "Capabilities the provider asked for."
            ],
            "type": "u32"
          },
          {
            "name": "metadataHash",
            "docs": [
              "Hash of the off-chain provider profile (hardware, pricing, methods)."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "jobsCompleted",
            "type": "u64"
          },
          {
            "name": "jobsDisputed",
            "type": "u64"
          },
          {
            "name": "registeredAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "purchaseParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "expectedPrice",
            "type": "u64"
          },
          {
            "name": "expectedVersion",
            "type": "u32"
          },
          {
            "name": "verifier",
            "type": "pubkey"
          },
          {
            "name": "verifierFee",
            "type": "u64"
          },
          {
            "name": "verifierCapability",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "reputation",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "salesCompleted",
            "type": "u32"
          },
          {
            "name": "purchasesCompleted",
            "type": "u32"
          },
          {
            "name": "volumeSold",
            "type": "u64"
          },
          {
            "name": "volumeBought",
            "type": "u64"
          },
          {
            "name": "disputedOrders",
            "type": "u32"
          },
          {
            "name": "refundedOrders",
            "type": "u32"
          },
          {
            "name": "verifiedContributions",
            "type": "u32"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "servicePaid",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "receipt",
            "type": "pubkey"
          },
          {
            "name": "payer",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "kind",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "serviceReceipt",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "payer",
            "type": "pubkey"
          },
          {
            "name": "reference",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "kind",
            "docs": [
              "Service kind (1 = storage, 2 = automated verification, 3 = other)."
            ],
            "type": "u8"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "paidAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "submission",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "order",
            "type": "pubkey"
          },
          {
            "name": "seller",
            "type": "pubkey"
          },
          {
            "name": "index",
            "type": "u8"
          },
          {
            "name": "commitment",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "version",
            "type": "u32"
          },
          {
            "name": "submittedAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "verdictParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "resultHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "specHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "benchmarkVersion",
            "type": "u32"
          },
          {
            "name": "passed",
            "type": "bool"
          },
          {
            "name": "expiresAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "verificationJob",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "requester",
            "type": "pubkey"
          },
          {
            "name": "jobId",
            "type": "u64"
          },
          {
            "name": "provider",
            "docs": [
              "Default = open to any approved provider with the capability."
            ],
            "type": "pubkey"
          },
          {
            "name": "requiredCapability",
            "type": "u32"
          },
          {
            "name": "assetCommitment",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "specHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "price",
            "type": "u64"
          },
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "deadline",
            "type": "i64"
          },
          {
            "name": "reviewWindowSecs",
            "type": "i64"
          },
          {
            "name": "reviewDeadline",
            "type": "i64"
          },
          {
            "name": "state",
            "type": {
              "defined": {
                "name": "jobState"
              }
            }
          },
          {
            "name": "resultHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "passed",
            "type": "bool"
          },
          {
            "name": "providerBps",
            "type": "u16"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ]
};
